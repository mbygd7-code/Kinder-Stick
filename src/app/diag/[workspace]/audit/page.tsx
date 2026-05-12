import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";
import { loadFramework } from "@/lib/framework/loader";
import {
  isStaleFinanceContent,
  isRemovedDomain,
} from "@/lib/stale-content-filter";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ISSUE_DATE = new Date().toISOString().slice(0, 10);
const TIMELINE_WEEKS = 12;

interface SessionRow {
  id: string;
  domain_code: string;
  state: string;
  trigger_kind: string | null;
  opened_at: string;
  resolved_at: string | null;
  severity: number;
  summary: string | null;
}

interface ActionRow {
  id: string;
  session_id: string;
  status: string;
  created_at: string;
  verified_at: string | null;
  deadline: string | null;
  title: string;
  owner_role: string | null;
}

interface SignalRow {
  id: string;
  kind: string;
  domain_code: string | null;
  severity: number;
  created_at: string;
}

export default async function AuditPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();

  const sb = supabaseAdmin();
  const org = await resolveOrgWithBackfill(sb, workspace);

  if (!org) {
    return <NoWorkspaceView workspace={workspace} />;
  }

  const ninetyDaysAgo = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [sesRes, actRes, sigRes] = await Promise.all([
    sb
      .from("agent_sessions")
      .select(
        "id, domain_code, state, trigger_kind, opened_at, resolved_at, severity, summary",
      )
      .eq("org_id", org.id)
      // 자금 관련 제거된 도메인 (A5/A12) 의 stale row 는 분석 대상에서 제외
      .not("domain_code", "in", "(A5,A12)")
      .order("opened_at", { ascending: false })
      .limit(500),
    sb
      .from("coaching_actions")
      .select(
        "id, session_id, status, created_at, verified_at, deadline, title, owner_role",
      )
      .eq("org_id", org.id)
      .order("created_at", { ascending: false }),
    sb
      .from("signal_events")
      .select("id, kind, domain_code, severity, created_at")
      .eq("org_id", org.id)
      .not("domain_code", "in", "(A5,A12)")
      .gte("created_at", ninetyDaysAgo)
      .order("created_at", { ascending: false }),
  ]);

  // 자금·IR stale 콘텐츠 제외 — title/summary 텍스트 검사
  const sessions = ((sesRes.data ?? []) as SessionRow[]).filter(
    (s) => !isStaleFinanceContent(s.summary),
  );
  const sessionIdSet = new Set(sessions.map((s) => s.id));
  const actions = ((actRes.data ?? []) as ActionRow[]).filter(
    (a) =>
      sessionIdSet.has(a.session_id) && !isStaleFinanceContent(a.title),
  );
  const signals = ((sigRes.data ?? []) as SignalRow[]).filter(
    (s) => !isRemovedDomain(s.domain_code),
  );

  const framework = loadFramework();

  // ---- Funnel ----
  const proactiveSignals = signals.filter(
    (s) => s.severity >= 3 && s.domain_code,
  );
  const proactiveSessions = sessions.filter(
    (s) => s.trigger_kind === "proactive",
  );
  const acceptedActions = actions; // any row in coaching_actions ≥ accepted
  const verifiedActions = actions.filter(
    (a) => a.status === "verified" || a.status === "completed",
  );

  // ---- State counts ----
  const sessionStateCount: Record<string, number> = {};
  for (const s of sessions) {
    sessionStateCount[s.state] = (sessionStateCount[s.state] ?? 0) + 1;
  }
  const actionStateCount: Record<string, number> = {};
  for (const a of actions) {
    actionStateCount[a.status] = (actionStateCount[a.status] ?? 0) + 1;
  }

  // ---- Cycle time (accepted → verified) ----
  const cycleDays: number[] = [];
  for (const a of actions) {
    if (a.status === "verified" && a.verified_at) {
      const days = Math.round(
        (new Date(a.verified_at).getTime() -
          new Date(a.created_at).getTime()) /
          (24 * 60 * 60 * 1000),
      );
      if (days >= 0) cycleDays.push(days);
    }
  }
  const medianCycle =
    cycleDays.length > 0
      ? cycleDays.sort((a, b) => a - b)[Math.floor(cycleDays.length / 2)]
      : null;

  // ---- Domain effectiveness ----
  const domainStats = new Map<
    string,
    {
      sessions: number;
      verified_actions: number;
      abandoned_sessions: number;
      open_sessions: number;
    }
  >();
  for (const s of sessions) {
    const stats = domainStats.get(s.domain_code) ?? {
      sessions: 0,
      verified_actions: 0,
      abandoned_sessions: 0,
      open_sessions: 0,
    };
    stats.sessions++;
    if (s.state === "abandoned") stats.abandoned_sessions++;
    else if (s.state !== "resolved") stats.open_sessions++;
    domainStats.set(s.domain_code, stats);
  }
  const sessionDomainBy = new Map(sessions.map((s) => [s.id, s.domain_code]));
  for (const a of actions) {
    if (a.status !== "verified" && a.status !== "completed") continue;
    const dom = sessionDomainBy.get(a.session_id);
    if (!dom) continue;
    const stats = domainStats.get(dom);
    if (!stats) continue;
    stats.verified_actions++;
  }

  // ---- Weekly timeline (sessions created + actions verified per week) ----
  const weeks: Array<{ start: Date; end: Date; label: string }> = [];
  for (let i = TIMELINE_WEEKS - 1; i >= 0; i--) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    weeks.push({
      start,
      end,
      label: `${start.getMonth() + 1}/${start.getDate()}`,
    });
  }
  const seriesSessions = weeks.map((w) =>
    sessions.filter(
      (s) =>
        new Date(s.opened_at) >= w.start && new Date(s.opened_at) < w.end,
    ).length,
  );
  const seriesVerified = weeks.map((w) =>
    actions.filter(
      (a) =>
        a.verified_at &&
        new Date(a.verified_at) >= w.start &&
        new Date(a.verified_at) < w.end,
    ).length,
  );
  const seriesAbandoned = weeks.map((w) =>
    sessions.filter(
      (s) =>
        s.state === "abandoned" &&
        s.resolved_at &&
        new Date(s.resolved_at) >= w.start &&
        new Date(s.resolved_at) < w.end,
    ).length,
  );

  // ---- Recent state changes (most recent 8 across sessions/actions) ----
  type ChangeRow = {
    when: Date;
    kind: "session" | "action";
    label: string;
    detail: string;
    color: "green" | "red" | "amber" | "neutral";
  };
  const recent: ChangeRow[] = [];
  for (const s of sessions) {
    if (s.state === "resolved" && s.resolved_at) {
      recent.push({
        when: new Date(s.resolved_at),
        kind: "session",
        label: `${s.domain_code} session resolved`,
        detail: s.summary?.slice(0, 80) ?? "",
        color: "green",
      });
    } else if (s.state === "abandoned" && s.resolved_at) {
      recent.push({
        when: new Date(s.resolved_at),
        kind: "session",
        label: `${s.domain_code} session abandoned`,
        detail: s.summary?.slice(0, 80) ?? "",
        color: "red",
      });
    }
  }
  for (const a of actions) {
    if (a.verified_at) {
      recent.push({
        when: new Date(a.verified_at),
        kind: "action",
        label: `action ${a.status}`,
        detail: `${a.owner_role ?? "?"} · ${a.title.slice(0, 70)}`,
        color: "green",
      });
    }
  }
  recent.sort((a, b) => b.when.getTime() - a.when.getTime());

  // ---- Headline metrics ----
  const totalSessions = sessions.length;
  const totalActions = actions.length;
  const verifiedRate =
    totalActions > 0 ? verifiedActions.length / totalActions : null;
  const findingEngagementRate =
    proactiveSessions.length > 0
      ? actions.filter((a) =>
          proactiveSessions.find((s) => s.id === a.session_id),
        ).length / proactiveSessions.length
      : null;

  return (
    <main className="min-h-dvh w-full pb-20">
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6 flex-wrap">
          <div className="flex items-baseline gap-3">
            <a
              href={`/diag/${workspace}/home`}
              className="kicker hover:text-ink"
            >
              ← 홈
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              {workspace} / audit
            </span>
          </div>
          <span className="label-mono">EFFECTIVENESS AUDIT</span>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-3">No. 10 · 운영 OS 효과</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Audit{" "}
          <span className="text-accent italic font-display">Report</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          코치 finding이 실제 액션·검증으로 이어지는지, 어느 도메인의
          코칭이 효과적인지, 시그널이 얼마나 빠르게 처리되는지 — 운영 OS의
          ROI를 정량화합니다.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric
          label="Total findings"
          value={String(totalSessions)}
          sub={`proactive ${proactiveSessions.length} · manual ${totalSessions - proactiveSessions.length}`}
        />
        <Metric
          label="Verified rate"
          value={
            verifiedRate === null
              ? "—"
              : `${Math.round(verifiedRate * 100)}%`
          }
          sub={`${verifiedActions.length} / ${totalActions}`}
          tone={
            verifiedRate === null
              ? undefined
              : verifiedRate >= 0.5
                ? "green"
                : verifiedRate >= 0.25
                  ? "amber"
                  : "red"
          }
        />
        <Metric
          label="Engagement rate"
          value={
            findingEngagementRate === null
              ? "—"
              : `${Math.round(findingEngagementRate * 100)}%`
          }
          sub="findings → action 채택"
          tone={
            findingEngagementRate === null
              ? undefined
              : findingEngagementRate >= 0.4
                ? "green"
                : findingEngagementRate >= 0.2
                  ? "amber"
                  : "red"
          }
        />
        <Metric
          label="Median cycle"
          value={medianCycle === null ? "—" : `${medianCycle}d`}
          sub="accepted → verified 중앙값"
        />
      </section>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Resolution funnel
          </span>
        </div>
      </div>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        <Funnel
          stages={[
            { label: "High-severity signals (90d)", value: proactiveSignals.length },
            { label: "Proactive findings", value: proactiveSessions.length },
            { label: "Actions accepted", value: acceptedActions.length },
            { label: "Actions verified/completed", value: verifiedActions.length },
          ]}
        />
      </section>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Domain effectiveness
          </span>
        </div>
      </div>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 overflow-x-auto">
        <table className="w-full text-sm border border-ink">
          <thead className="bg-paper-deep border-b border-ink">
            <tr>
              <Th>Domain</Th>
              <Th className="text-center">Sessions</Th>
              <Th className="text-center">Verified</Th>
              <Th className="text-center">Abandoned</Th>
              <Th className="text-center">Open</Th>
              <Th>Effectiveness</Th>
            </tr>
          </thead>
          <tbody>
            {framework.domains.map((d) => {
              const stats = domainStats.get(d.code) ?? {
                sessions: 0,
                verified_actions: 0,
                abandoned_sessions: 0,
                open_sessions: 0,
              };
              const eff =
                stats.sessions === 0
                  ? null
                  : stats.verified_actions / stats.sessions;
              const tone =
                eff === null
                  ? "neutral"
                  : eff >= 0.5
                    ? "green"
                    : eff >= 0.2
                      ? "amber"
                      : "red";
              return (
                <tr key={d.code} className="border-b border-ink-soft/30">
                  <Td className="font-mono text-xs">
                    <span>{d.code}</span>{" "}
                    <span className="font-display text-sm">{d.name_ko}</span>
                  </Td>
                  <Td className="text-center font-display">
                    {stats.sessions}
                  </Td>
                  <Td className="text-center font-display text-signal-green">
                    {stats.verified_actions}
                  </Td>
                  <Td className="text-center font-display text-signal-red">
                    {stats.abandoned_sessions}
                  </Td>
                  <Td className="text-center font-display">
                    {stats.open_sessions}
                  </Td>
                  <Td>
                    <EffBar value={eff} tone={tone} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Weekly throughput (last 12 weeks)
          </span>
        </div>
      </div>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        <div className="area-card">
          <WeeklyChart
            weeks={weeks}
            sessions={seriesSessions}
            verified={seriesVerified}
            abandoned={seriesAbandoned}
          />
          <div className="mt-3 flex flex-wrap gap-4 label-mono">
            <span>
              <span className="inline-block w-3 h-1 align-middle bg-ink" /> sessions opened
            </span>
            <span>
              <span className="inline-block w-3 h-1 align-middle bg-signal-green" /> verified actions
            </span>
            <span>
              <span className="inline-block w-3 h-1 align-middle bg-signal-red" /> abandoned sessions
            </span>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Recent resolutions ({recent.length})
          </span>
        </div>
      </div>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        {recent.length === 0 ? (
          <div className="note-box">
            아직 resolved/verified 건이 없습니다.
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.slice(0, 12).map((r, i) => (
              <li
                key={i}
                className={`border-l-4 pl-4 py-2 ${
                  r.color === "green"
                    ? "border-signal-green"
                    : r.color === "red"
                      ? "border-signal-red"
                      : r.color === "amber"
                        ? "border-signal-amber"
                        : "border-ink-soft"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="font-mono text-xs">
                    <strong>{r.label}</strong> — {r.detail}
                  </p>
                  <span className="label-mono">
                    {r.when.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a
          href={`/diag/${workspace}/home`}
          className="label-mono hover:text-ink"
        >
          ← 홈으로
        </a>
        <p className="label-mono">{ISSUE_DATE} · audit v1</p>
      </footer>
    </main>
  );
}

// ============================================================
// Sub-components
// ============================================================

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red";
}) {
  const color =
    tone === "green"
      ? "text-signal-green"
      : tone === "amber"
        ? "text-signal-amber"
        : tone === "red"
          ? "text-signal-red"
          : "text-ink";
  return (
    <div className="metric-card">
      <p className="label-mono">{label}</p>
      <p className={`num mt-1 ${color}`}>{value}</p>
      {sub ? <p className="mt-1 label-mono">{sub}</p> : null}
    </div>
  );
}

function Funnel({
  stages,
}: {
  stages: Array<{ label: string; value: number }>;
}) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const conv =
          i > 0 && stages[i - 1].value > 0
            ? Math.round((s.value / stages[i - 1].value) * 100)
            : null;
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="font-mono text-xs">
                {i + 1}. {s.label}
              </span>
              <span className="label-mono">
                {s.value}
                {conv !== null ? ` · ${conv}% from prev` : null}
              </span>
            </div>
            <div className="bar-track">
              <div
                className={`bar-fill ${
                  i === 0
                    ? "cobalt"
                    : i === 1
                      ? "amber"
                      : i === 2
                        ? "amber"
                        : "green"
                }`}
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EffBar({
  value,
  tone,
}: {
  value: number | null;
  tone: "green" | "amber" | "red" | "neutral";
}) {
  if (value === null) {
    return <span className="label-mono">—</span>;
  }
  const pct = Math.round(value * 100);
  const fillClass =
    tone === "green"
      ? "green"
      : tone === "amber"
        ? "amber"
        : tone === "red"
          ? "red"
          : "cobalt";
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="bar-track flex-1 !h-3">
        <div
          className={`bar-fill ${fillClass}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="font-mono text-xs">{pct}%</span>
    </div>
  );
}

function WeeklyChart({
  weeks,
  sessions,
  verified,
  abandoned,
}: {
  weeks: Array<{ label: string }>;
  sessions: number[];
  verified: number[];
  abandoned: number[];
}) {
  const w = 720;
  const h = 140;
  const max = Math.max(1, ...sessions, ...verified, ...abandoned);
  const xs = weeks.map((_, i) => (i / (weeks.length - 1)) * w);
  const yScale = (v: number) => h - (v / max) * h;
  const sessionPath = sessions
    .map((v, i) => `${xs[i]},${yScale(v).toFixed(1)}`)
    .join(" ");
  const verifiedPath = verified
    .map((v, i) => `${xs[i]},${yScale(v).toFixed(1)}`)
    .join(" ");
  const abandonedPath = abandoned
    .map((v, i) => `${xs[i]},${yScale(v).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h + 24}`}
      className="w-full"
      preserveAspectRatio="none"
    >
      {[0.25, 0.5, 0.75].map((g) => (
        <line
          key={g}
          x1={0}
          x2={w}
          y1={yScale(max * g)}
          y2={yScale(max * g)}
          className="stroke-ink-soft/20"
          strokeDasharray="3 3"
        />
      ))}
      <polyline
        points={abandonedPath}
        className="stroke-signal-red"
        fill="none"
        strokeWidth={2}
      />
      <polyline
        points={verifiedPath}
        className="stroke-signal-green"
        fill="none"
        strokeWidth={2}
      />
      <polyline
        points={sessionPath}
        className="stroke-ink"
        fill="none"
        strokeWidth={2}
      />
      {weeks.map((wk, i) => (
        <text
          key={i}
          x={xs[i]}
          y={h + 16}
          className="fill-ink-soft font-mono text-[9px]"
          textAnchor="middle"
        >
          {wk.label}
        </text>
      ))}
    </svg>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-3 py-3 label-mono font-semibold !text-ink ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function NoWorkspaceView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">No workspace</p>
        <h1 className="font-display text-3xl">
          이 워크스페이스에 audit 데이터가 없습니다
        </h1>
        <a href={`/diag/${workspace}`} className="btn-primary mt-6 inline-flex">
          진단 시작 <span className="font-mono text-xs">→</span>
        </a>
      </div>
    </main>
  );
}

import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFramework } from "@/lib/framework/loader";
import { fetchWorkspaceTimeline } from "@/lib/agents/timeline-context";
import { getCurrentUser } from "@/lib/supabase/auth";
import { ClaimButton } from "./_claim-button";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ISSUE_DATE = new Date().toISOString().slice(0, 10);

interface ProactiveSessionRow {
  id: string;
  domain_code: string;
  severity: number;
  state: string;
  summary: string | null;
  opened_at: string;
  trigger_metadata: Record<string, unknown> | null;
}

interface ActionSummary {
  status: string;
  count: number;
}

interface ActionRowMin {
  id: string;
  status: string;
  deadline: string | null;
  title: string;
  owner_role: string | null;
}

interface SignalRow {
  id: string;
  kind: string;
  domain_code: string | null;
  narrative: string;
  severity: number;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface DiagRow {
  id: string;
  respondent_num: number;
  completed_at: string;
  stage: string | null;
}

export default async function DashboardPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();

  const sb = supabaseAdmin();

  // Resolve org
  const { data: org } = await sb
    .from("organizations")
    .select("id, name, stage, plan, created_at")
    .eq("name", workspace)
    .maybeSingle();

  if (!org) {
    return <NoWorkspaceView workspace={workspace} />;
  }

  // Auth + membership status (for claim/sign-in surface)
  const currentUser = await getCurrentUser();
  let alreadyMember = false;
  let memberRole: string | null = null;
  if (currentUser) {
    const { data: m } = await sb
      .from("org_members")
      .select("role")
      .eq("org_id", org.id)
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (m) {
      alreadyMember = true;
      memberRole = m.role as string;
    }
  }

  // Fetch in parallel
  const [
    proactiveRes,
    actionsRes,
    signalsRes,
    diagRes,
    timeline,
    framework,
  ] = await Promise.all([
    sb
      .from("agent_sessions")
      .select(
        "id, domain_code, severity, state, summary, opened_at, trigger_metadata",
      )
      .eq("org_id", org.id)
      .eq("trigger_kind", "proactive")
      .in("state", [
        "action_planning",
        "analyzing",
        "diagnosing",
        "evidence_request",
      ])
      .order("severity", { ascending: false })
      .order("opened_at", { ascending: false })
      .limit(6),
    sb
      .from("coaching_actions")
      .select("id, status, deadline, title, owner_role")
      .eq("org_id", org.id),
    sb
      .from("signal_events")
      .select("id, kind, domain_code, narrative, severity, created_at, metadata")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .limit(8),
    sb
      .from("diagnosis_responses")
      .select("id, respondent_num, completed_at, stage")
      .eq("workspace_id", workspace)
      .order("completed_at", { ascending: false })
      .limit(1),
    fetchWorkspaceTimeline(sb, workspace, 4),
    Promise.resolve(loadFramework()),
  ]);

  const proactiveFindings = (proactiveRes.data ?? []) as ProactiveSessionRow[];
  const allActions = (actionsRes.data ?? []) as ActionRowMin[];
  const recentSignals = (signalsRes.data ?? []) as SignalRow[];
  const latestDiag = ((diagRes.data ?? [])[0] ?? null) as DiagRow | null;

  // Action summary
  const actionsByStatus: Record<string, number> = {};
  for (const a of allActions)
    actionsByStatus[a.status] = (actionsByStatus[a.status] ?? 0) + 1;
  const now = Date.now();
  const overdue = allActions.filter(
    (a) =>
      (a.status === "accepted" || a.status === "in_progress") &&
      a.deadline &&
      new Date(a.deadline).getTime() < now,
  );

  // Quarterly check
  const daysSinceLatest = latestDiag
    ? Math.floor(
        (now - new Date(latestDiag.completed_at).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;
  const quarterlyDue = daysSinceLatest !== null && daysSinceLatest >= 90;

  // Latest snapshot from timeline (for headline metrics)
  const latestSnapshot = timeline[timeline.length - 1] ?? null;
  const prevSnapshot = timeline[timeline.length - 2] ?? null;
  const overallDelta =
    latestSnapshot?.overall_score !== null &&
    latestSnapshot?.overall_score !== undefined &&
    prevSnapshot?.overall_score !== null &&
    prevSnapshot?.overall_score !== undefined
      ? latestSnapshot.overall_score - prevSnapshot.overall_score
      : null;

  // System status (overall health indicator)
  const systemStatus = computeSystemStatus({
    fp_6m: latestSnapshot?.fp_6m ?? 0,
    overdueActions: overdue.length,
    pendingFindings: proactiveFindings.filter((f) => f.severity >= 4).length,
    redCriticalCount: latestSnapshot?.red_critical_codes.length ?? 0,
  });

  return (
    <main className="min-h-dvh w-full pb-20">
      {/* MASTHEAD */}
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap">
            <a href="/diag" className="kicker hover:text-ink">
              ← Domain Map
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              {workspace} · dashboard
            </span>
            {currentUser ? (
              <>
                <span className="hidden sm:inline label-mono">·</span>
                <a href="/me" className="label-mono hover:text-ink">
                  /me ({currentUser.email?.split("@")[0]})
                </a>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <ClaimButton
              workspace={workspace}
              authed={!!currentUser}
              alreadyMember={alreadyMember}
              role={memberRole}
              email={currentUser?.email ?? null}
            />
            <span className="label-mono">WORKSPACE HOME</span>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-3">No. 09 · Workspace dashboard</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          {workspace}
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-ink-soft">
          {latestDiag ? (
            <>
              {timeline.length}분기 · 응답 #{latestDiag.respondent_num} ·
              마지막 진단 {latestDiag.completed_at.slice(0, 10)} · stage{" "}
              {org.stage ?? "—"}
            </>
          ) : (
            "아직 진단을 시작하지 않았습니다."
          )}
        </p>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span
            className={`tag ${
              systemStatus.tone === "green"
                ? "tag-green"
                : systemStatus.tone === "amber"
                  ? "tag-gold"
                  : "tag-red"
            }`}
          >
            {systemStatus.label}
          </span>
          {quarterlyDue ? (
            <span className="tag tag-red">분기 진단 만료 · {daysSinceLatest}d</span>
          ) : null}
          {overdue.length > 0 ? (
            <span className="tag tag-red">overdue actions {overdue.length}</span>
          ) : null}
          {proactiveFindings.length > 0 ? (
            <span className="tag tag-accent">
              🤖 pending findings {proactiveFindings.length}
            </span>
          ) : null}
        </div>
      </section>

      {/* SUMMARY METRICS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric
          label="Overall (latest)"
          value={
            latestSnapshot?.overall_score === null ||
            latestSnapshot?.overall_score === undefined
              ? "—"
              : Math.round(latestSnapshot.overall_score).toString()
          }
          sub={
            overallDelta === null
              ? "단일 분기"
              : `Δ ${overallDelta >= 0 ? "+" : ""}${overallDelta.toFixed(1)} vs 전분기`
          }
          tone={
            overallDelta === null
              ? undefined
              : overallDelta >= 5
                ? "green"
                : overallDelta <= -5
                  ? "red"
                  : "amber"
          }
        />
        <Metric
          label="P(fail, 6m)"
          value={
            latestSnapshot
              ? `${Math.round(latestSnapshot.fp_6m * 100)}%`
              : "—"
          }
          sub={
            latestSnapshot
              ? `red critical: ${latestSnapshot.red_critical_codes.length || "0"}`
              : "—"
          }
          tone={
            (latestSnapshot?.fp_6m ?? 0) >= 0.45
              ? "red"
              : (latestSnapshot?.fp_6m ?? 0) >= 0.25
                ? "amber"
                : "green"
          }
        />
        <Metric
          label="Active actions"
          value={String(
            (actionsByStatus.accepted ?? 0) + (actionsByStatus.in_progress ?? 0),
          )}
          sub={`overdue ${overdue.length} · verified ${actionsByStatus.verified ?? 0}`}
          tone={overdue.length > 0 ? "red" : undefined}
        />
        <Metric
          label="Pending findings"
          value={String(proactiveFindings.length)}
          sub={`severity ≥4: ${proactiveFindings.filter((f) => f.severity >= 4).length}`}
          tone={
            proactiveFindings.length === 0
              ? "green"
              : proactiveFindings.filter((f) => f.severity >= 4).length > 0
                ? "red"
                : "amber"
          }
        />
      </section>

      {/* PROACTIVE FINDINGS */}
      {proactiveFindings.length > 0 ? (
        <>
          <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
            <div className="divider-ornament">
              <span className="font-mono text-xs uppercase tracking-widest">
                🤖 § Pending coach findings · {proactiveFindings.length}
              </span>
            </div>
          </div>
          <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {proactiveFindings.map((f) => {
              const dom = framework.domains.find((d) => d.code === f.domain_code);
              return (
                <a
                  key={f.id}
                  href={`/diag/${workspace}/coach/${f.domain_code}`}
                  className={`area-card hover:bg-paper-deep/30 block transition-colors ${
                    f.severity >= 4
                      ? "!border-signal-red bg-soft-red/30"
                      : f.severity >= 3
                        ? "!border-signal-amber bg-soft-amber/30"
                        : ""
                  }`}
                >
                  <header className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="kicker">
                        {f.domain_code} · {dom?.name_ko ?? "—"}
                      </span>
                      <span className="label-mono">state {f.state}</span>
                    </div>
                    <span
                      className={`tag ${
                        f.severity >= 4
                          ? "tag-red"
                          : f.severity >= 3
                            ? "tag-gold"
                            : "tag-filled"
                      }`}
                    >
                      severity {f.severity}
                    </span>
                  </header>
                  <p className="mt-3 font-display text-lg leading-tight">
                    {f.summary ?? "(요약 없음 — 클릭해 상세 보기)"}
                  </p>
                  <p className="mt-2 label-mono">
                    triggered {new Date(f.opened_at).toISOString().slice(0, 16).replace("T", " ")}
                    {" · "}
                    클릭해서 진단·액션 채택 →
                  </p>
                </a>
              );
            })}
          </section>
        </>
      ) : null}

      {/* DOMAIN HEATMAP (compact) */}
      {latestSnapshot ? (
        <>
          <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
            <div className="divider-ornament">
              <span className="font-mono text-xs uppercase tracking-widest">
                § Domain status (current quarter)
              </span>
            </div>
          </div>
          <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-2 md:grid-cols-7 gap-2">
            {framework.domains.map((d) => {
              const ds = latestSnapshot.domain_scores.find(
                (x) => x.code === d.code,
              );
              const score = ds?.score ?? null;
              const tone =
                score === null
                  ? "neutral"
                  : score >= d.thresholds.green
                    ? "green"
                    : score >= d.thresholds.yellow
                      ? "amber"
                      : score >= d.thresholds.red
                        ? "amber"
                        : "red";
              return (
                <a
                  key={d.code}
                  href={`/diag/${workspace}/coach/${d.code}`}
                  className={`metric-card !p-3 hover:bg-paper-deep/30 block transition-colors ${
                    tone === "red"
                      ? "!border-signal-red"
                      : tone === "amber"
                        ? "!border-signal-amber"
                        : tone === "green"
                          ? "!border-signal-green"
                          : ""
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-xs">{d.code}</span>
                    <span
                      className={`text-[10px] font-mono ${
                        d.tier === "critical"
                          ? "text-accent"
                          : d.tier === "important"
                            ? "text-gold"
                            : "text-ink-soft"
                      }`}
                    >
                      {d.tier[0].toUpperCase()}
                    </span>
                  </div>
                  <p className="font-display text-2xl mt-1">
                    {score === null ? "—" : Math.round(score)}
                  </p>
                  <p className="label-mono text-[10px] truncate">
                    {d.name_ko}
                  </p>
                </a>
              );
            })}
          </section>
        </>
      ) : null}

      {/* RECENT ACTIVITY */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Recent activity
          </span>
        </div>
      </div>
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* signals */}
        <div className="area-card">
          <header className="flex items-baseline justify-between mb-3">
            <p className="kicker">Signal feed</p>
            <a
              href={`/diag/${workspace}/signals`}
              className="label-mono hover:text-ink"
            >
              all →
            </a>
          </header>
          {recentSignals.length === 0 ? (
            <p className="text-sm text-ink-soft">
              아직 시그널이 없습니다. /signals 에서 mock 주입 가능.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentSignals.slice(0, 5).map((s) => (
                <li
                  key={s.id}
                  className={`border-l-4 pl-3 py-1.5 ${
                    s.severity >= 4
                      ? "border-signal-red"
                      : s.severity >= 3
                        ? "border-signal-amber"
                        : "border-ink-soft"
                  }`}
                >
                  <p className="font-mono text-xs leading-snug">{s.narrative}</p>
                  <p className="label-mono mt-0.5">
                    {new Date(s.created_at).toISOString().slice(0, 16).replace("T", " ")}
                    {s.domain_code ? ` · ${s.domain_code}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* actions summary */}
        <div className="area-card">
          <header className="flex items-baseline justify-between mb-3">
            <p className="kicker">Action board</p>
            <a
              href={`/diag/${workspace}/actions`}
              className="label-mono hover:text-ink"
            >
              all →
            </a>
          </header>
          {allActions.length === 0 ? (
            <p className="text-sm text-ink-soft">
              아직 채택된 액션이 없습니다. 코치 페이지에서 SMART 액션 채택.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-5 gap-1">
                {(
                  [
                    "accepted",
                    "in_progress",
                    "completed",
                    "verified",
                    "abandoned",
                  ] as const
                ).map((status) => (
                  <div key={status} className="text-center">
                    <p className="num text-xl">{actionsByStatus[status] ?? 0}</p>
                    <p className="label-mono text-[10px]">{status}</p>
                  </div>
                ))}
              </div>
              {overdue.length > 0 ? (
                <div className="mt-4 dotted-rule pt-3">
                  <p className="kicker !text-signal-red mb-2">
                    OVERDUE · {overdue.length}건
                  </p>
                  <ul className="space-y-1">
                    {overdue.slice(0, 3).map((a) => {
                      const d = a.deadline ? new Date(a.deadline) : null;
                      const daysOver = d
                        ? Math.ceil((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000))
                        : null;
                      return (
                        <li key={a.id} className="text-sm">
                          <span className="font-mono text-xs">
                            {a.owner_role ?? "?"} · {daysOver}d 지남
                          </span>{" "}
                          <span className="text-ink-soft">
                            {a.title.slice(0, 60)}
                            {a.title.length > 60 ? "…" : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {/* QUICK NAV */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Navigate
          </span>
        </div>
      </div>
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 flex flex-wrap gap-3">
        <a href={`/diag/${workspace}`} className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          진단 응답 (편집)
        </a>
        <a href={`/diag/${workspace}/result`} className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          Result
        </a>
        <a href={`/diag/${workspace}/timeline`} className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          Timeline
        </a>
        <a href={`/diag/${workspace}/actions`} className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          Action board
        </a>
        <a href={`/diag/${workspace}/signals`} className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          KPI feed
        </a>
        <a href={`/diag/${workspace}/audit`} className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          Audit
        </a>
        <a href={`/diag/${workspace}/integrations`} className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          Integrations
        </a>
        <a href={`/diag/${workspace}/members`} className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          Members
        </a>
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a href="/diag" className="label-mono hover:text-ink">
          ← Domain Map
        </a>
        <p className="label-mono">{ISSUE_DATE} · dashboard v1</p>
      </footer>
    </main>
  );
}

// ============================================================
// Helpers
// ============================================================

function computeSystemStatus({
  fp_6m,
  overdueActions,
  pendingFindings,
  redCriticalCount,
}: {
  fp_6m: number;
  overdueActions: number;
  pendingFindings: number;
  redCriticalCount: number;
}): { tone: "green" | "amber" | "red"; label: string } {
  if (fp_6m >= 0.45 || redCriticalCount >= 2 || overdueActions >= 3) {
    return { tone: "red", label: "Red zone — 즉각 조치 필요" };
  }
  if (
    fp_6m >= 0.25 ||
    redCriticalCount >= 1 ||
    overdueActions >= 1 ||
    pendingFindings >= 2
  ) {
    return { tone: "amber", label: "Caution — 점검 필요" };
  }
  return { tone: "green", label: "On track" };
}

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

function NoWorkspaceView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">Workspace not initialized</p>
        <h1 className="font-display text-3xl leading-tight">
          이 워크스페이스는 아직 진단을 한 적이 없습니다
        </h1>
        <p className="mt-3 text-ink-soft text-sm">
          <span className="font-mono">{workspace}</span> 로 첫 진단을 시작하세요.
        </p>
        <a
          href={`/diag/${workspace}`}
          className="btn-primary mt-6 inline-flex"
        >
          진단 시작 <span className="font-mono text-xs">→</span>
        </a>
      </div>
    </main>
  );
}

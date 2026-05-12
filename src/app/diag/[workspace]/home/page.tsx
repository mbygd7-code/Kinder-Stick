/**
 * /diag/[workspace]/home — 통합 워크스페이스 허브
 *
 * 진단 직후 자연스럽게 이어지는 한 페이지 운영 화면.
 * 기존 result + dashboard + signals 의 핵심을 하나로 묶어 직원이 한눈에:
 *   ① 우리 회사 지금 어때 (점수·실패확률·요인 분해)
 *   ② 이번 주 무엇 해야 해 (Top 3 액션)
 *   ③ 어디로 가야 해 (도메인 코치·워크리스트·결과 상세)
 *
 * /result, /dashboard, /signals 는 깊이 보기 보조 페이지로 유지.
 */
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";
import { loadFramework } from "@/lib/framework/loader";
import { fetchWorkspaceTimeline } from "@/lib/agents/timeline-context";
import { getCurrentUser } from "@/lib/supabase/auth";
import { ClaimButton } from "./_claim-button";
import {
  computeSubItemScore,
  computeGroupScore,
  computeDomainScore,
  computeOverallScore,
  computeFailureProbability,
  computeConsensus,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
  type GroupDef,
  type DomainDef,
  type DomainScoreResult,
} from "@/lib/scoring";
import {
  isStaleFinanceContent,
  isRemovedDomain,
} from "@/lib/stale-content-filter";

interface Props {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ session?: string; respondent?: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ISSUE_DATE = new Date().toISOString().slice(0, 10);

// ============================================================
// Types (subset of dashboard/result)
// ============================================================
interface DiagRow {
  id: string;
  workspace_id: string;
  respondent_num: number;
  role: string | null;
  perspective: string | null;
  stage: string | null;
  responses: Record<
    string,
    {
      belief: number;
      evidence: number | null;
      na?: boolean;
      evidence_recorded_at: string;
    }
  > | null;
  result: Record<string, unknown> | null;
  completed_at: string;
}

interface ProactiveSession {
  id: string;
  domain_code: string;
  severity: number;
  state: string;
  summary: string | null;
  opened_at: string;
}

interface ActionRow {
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
}

// ============================================================
// Page
// ============================================================

export default async function HomePage({ params, searchParams }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();
  const sp = await searchParams;

  const sb = supabaseAdmin();
  const org = await resolveOrgWithBackfill(sb, workspace);

  if (!org) {
    return <FirstVisitView workspace={workspace} />;
  }

  // Auth + membership
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

  // Parallel fetch
  const [diagRes, proactiveRes, actionsRes, signalsRes] = await Promise.all([
    sb
      .from("diagnosis_responses")
      .select(
        "id, workspace_id, respondent_num, role, perspective, stage, responses, result, completed_at",
      )
      .eq("workspace_id", workspace)
      .order("respondent_num", { ascending: true }),
    sb
      .from("agent_sessions")
      .select("id, domain_code, severity, state, summary, opened_at")
      .eq("org_id", org.id)
      .in("state", [
        "action_planning",
        "analyzing",
        "diagnosing",
        "evidence_request",
      ])
      .not("domain_code", "in", "(A5,A12)")
      .order("severity", { ascending: false })
      .order("opened_at", { ascending: false })
      .limit(6),
    sb
      .from("coaching_actions")
      .select("id, status, deadline, title, owner_role")
      .eq("org_id", org.id),
    sb
      .from("signal_events")
      .select("id, kind, domain_code, narrative, severity, created_at")
      .eq("org_id", org.id)
      .not("domain_code", "in", "(A5,A12)")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const rows = (diagRes.data ?? []) as DiagRow[];
  if (rows.length === 0) {
    return (
      <NoDiagYet
        workspace={workspace}
        currentUser={currentUser}
        alreadyMember={alreadyMember}
        memberRole={memberRole}
      />
    );
  }

  const framework = loadFramework();
  const aggregate = aggregateRespondents(framework, rows);

  // Quarterly check
  const latestRow = rows[rows.length - 1];
  const latestDate = new Date(latestRow.completed_at);
  const now = Date.now();
  const daysSinceLatest = Math.floor(
    (now - latestDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  const quarterlyDue = daysSinceLatest >= 90;

  // Action analysis — 자금·IR 관련 stale 액션 제외 (Appendix C 적용 후 잔재)
  const allActions = ((actionsRes.data ?? []) as ActionRow[]).filter(
    (a) => !isStaleFinanceContent(a.title),
  );
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const overdueActions = allActions.filter(
    (a) =>
      (a.status === "accepted" || a.status === "in_progress") &&
      a.deadline &&
      new Date(a.deadline).getTime() < now,
  );
  const dueSoonActions = allActions
    .filter(
      (a) =>
        (a.status === "accepted" || a.status === "in_progress") &&
        a.deadline &&
        new Date(a.deadline).getTime() < now + SEVEN_DAYS,
    )
    .sort((a, b) => {
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    });
  const activeActionCount = allActions.filter(
    (a) => a.status === "accepted" || a.status === "in_progress",
  ).length;
  const verifiedCount = allActions.filter((a) => a.status === "verified").length;

  // Proactive findings — 자금·IR 관련 stale summary 제외
  const proactiveFindings = ((proactiveRes.data ?? []) as ProactiveSession[]).filter(
    (f) =>
      !isRemovedDomain(f.domain_code) && !isStaleFinanceContent(f.summary),
  );
  const highSeverity = proactiveFindings.filter((f) => f.severity >= 4);
  // Recent signals — 자금·IR 관련 stale narrative 제외
  const recentSignals = ((signalsRes.data ?? []) as SignalRow[]).filter(
    (s) =>
      !isRemovedDomain(s.domain_code) && !isStaleFinanceContent(s.narrative),
  );

  // Top 3 actions for "이번 주 할 일"
  const thisWeek = buildThisWeekList(
    dueSoonActions,
    highSeverity,
    framework,
    workspace,
    now,
  );

  // Status indicator
  const fp6m = aggregate.fp["6m"].final;
  const status = computeStatus({
    fp_6m: fp6m,
    overdue: overdueActions.length,
    redCritical: aggregate.fp["6m"].red_critical_domains.length,
    pendingHigh: highSeverity.length,
  });

  const stageLabel = STAGE_LABELS[aggregate.stage] ?? aggregate.stage;
  const overallNum = aggregate.overall ?? 0;
  const overallTone =
    aggregate.overall === null
      ? "neutral"
      : aggregate.overall >= 70
        ? "green"
        : aggregate.overall >= 40
          ? "amber"
          : "red";

  return (
    <main className="min-h-dvh w-full pb-24">
      {/* MASTHEAD */}
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-5 flex items-baseline justify-between gap-6 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap">
            <a href="/diag" className="kicker hover:text-ink">
              ← 워크스페이스 목록
            </a>
            <span className="hidden sm:inline label-mono opacity-50">·</span>
            <span className="hidden sm:inline label-mono">{workspace}</span>
            {currentUser ? (
              <>
                <span className="hidden sm:inline label-mono opacity-50">·</span>
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
            <span className="label-mono">HOME</span>
          </div>
        </div>
      </header>

      {/* HERO — 현재 상태 한눈에 */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12">
        <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
          <p className="kicker">현재 상태</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`tag ${
                status.tone === "green"
                  ? "tag-green"
                  : status.tone === "amber"
                    ? "tag-gold"
                    : "tag-red"
              }`}
            >
              {status.label}
            </span>
            <span className="label-mono">
              응답자 {rows.length}명 · {stageLabel}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Overall */}
          <div className="border-2 border-ink p-6 sm:p-7">
            <p className="kicker mb-2">종합 건강도</p>
            <p className="font-display leading-none">
              <span
                className={`text-6xl sm:text-7xl ${
                  overallTone === "red"
                    ? "text-signal-red"
                    : overallTone === "amber"
                      ? "text-signal-amber"
                      : overallTone === "green"
                        ? "text-signal-green"
                        : "text-ink"
                }`}
              >
                {aggregate.overall === null ? "—" : Math.round(overallNum)}
              </span>
              <span className="text-2xl text-ink-soft"> / 100</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              {aggregate.overall === null
                ? "응답이 부족합니다."
                : aggregate.overall >= 70
                  ? "양호. 정기 점검을 유지하세요."
                  : aggregate.overall >= 40
                    ? "주의. 빨간 영역부터 점검하세요."
                    : "위험. 이번 주 안에 책임자 지정 + 액션 채택이 필요합니다."}
            </p>
          </div>

          {/* P(fail, 6m) */}
          <div className="border-2 border-ink p-6 sm:p-7">
            <p className="kicker mb-2">6개월 내 어려움 가능성</p>
            <p className="font-display leading-none">
              <span
                className={`text-6xl sm:text-7xl ${
                  fp6m >= 0.45
                    ? "text-signal-red"
                    : fp6m >= 0.25
                      ? "text-signal-amber"
                      : "text-signal-green"
                }`}
              >
                {Math.round(fp6m * 100)}
              </span>
              <span className="text-2xl text-ink-soft">%</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              평균 {stageLabel} 회사 prior{" "}
              {Math.round(aggregate.fp["6m"].prior * 100)}% · 우리 진단으로 보정됨.
            </p>
          </div>

          {/* P(fail, 12m) */}
          <div className="border-2 border-ink p-6 sm:p-7">
            <p className="kicker mb-2">12개월 내 어려움 가능성</p>
            <p className="font-display leading-none">
              <span
                className={`text-6xl sm:text-7xl ${
                  aggregate.fp["12m"].final >= 0.55
                    ? "text-signal-red"
                    : aggregate.fp["12m"].final >= 0.35
                      ? "text-signal-amber"
                      : "text-signal-green"
                }`}
              >
                {Math.round(aggregate.fp["12m"].final * 100)}
              </span>
              <span className="text-2xl text-ink-soft">%</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              평균 prior {Math.round(aggregate.fp["12m"].prior * 100)}% · 점수가
              높아질수록 함께 낮아짐.
            </p>
          </div>
        </div>

        {/* 깊이 보기 1줄 링크 */}
        <p className="mt-4 label-mono">
          ⓘ 어떻게 계산됐는지 ·{" "}
          <a
            href={`/diag/${workspace}/result`}
            className="underline hover:text-ink"
          >
            요인 분해 + 도메인 breakdown 보기 →
          </a>
        </p>
      </section>

      {/* QUARTERLY DUE — 90일 경과 */}
      {quarterlyDue ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8">
          <div className="border-2 border-signal-amber bg-soft-amber/40 p-5 sm:p-6 flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="kicker mb-1 !text-signal-amber">
                Quarterly review · {daysSinceLatest}일 경과
              </p>
              <h2 className="font-display text-xl sm:text-2xl leading-tight">
                지난 분기 진단 — 재응답을 권장합니다
              </h2>
              <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                90일 이상 경과하면 KPI/팀/시장 변동이 반영되지 않아 코치 정확도가 떨어집니다.
              </p>
            </div>
            <a href={`/diag/${workspace}`} className="btn-primary">
              재진단 시작 <span className="font-mono text-xs">→</span>
            </a>
          </div>
        </section>
      ) : null}

      {/* 이번 주 할 일 — Top 3 */}
      {thisWeek.length > 0 ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
          <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
            <h2 className="font-display text-3xl sm:text-4xl leading-tight">
              이번 주 우리 팀이 할 일
            </h2>
            <span className="label-mono">
              지연 {overdueActions.length} · 7일 내 마감{" "}
              {dueSoonActions.length - overdueActions.length} · 긴급 코칭{" "}
              {highSeverity.length}
            </span>
          </div>
          <p className="text-sm text-ink-soft mb-5 max-w-2xl leading-relaxed">
            점수가 아니라 액션이 변화의 단위입니다. 아래 항목을 하나씩 마감하면
            다음 주 이 자리에 더 적은 항목이 남습니다.
          </p>
          <ol className="space-y-3">
            {thisWeek.map((item, i) => (
              <li key={item.key}>
                <a
                  href={item.href}
                  className={`flex items-start gap-4 border-l-4 bg-paper p-4 sm:p-5 hover:bg-paper-deep/40 transition-colors ${
                    item.tone === "red"
                      ? "border-signal-red"
                      : item.tone === "amber"
                        ? "border-signal-amber"
                        : "border-ink"
                  }`}
                >
                  <span className="font-display text-3xl text-accent leading-none shrink-0 w-10">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span
                        className={`tag ${
                          item.tone === "red"
                            ? "tag-red"
                            : item.tone === "amber"
                              ? "tag-gold"
                              : "tag-filled"
                        }`}
                      >
                        {item.kind}
                      </span>
                      <span className="label-mono">{item.meta}</span>
                    </div>
                    <p className="mt-1.5 font-display text-lg leading-snug">
                      {item.title}
                    </p>
                    {item.subtitle ? (
                      <p className="mt-1 text-sm text-ink-soft">
                        {item.subtitle}
                      </p>
                    ) : null}
                  </div>
                  <span className="font-mono text-base text-ink-soft shrink-0 self-center">
                    →
                  </span>
                </a>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-4 label-mono">
            <a
              href={`/diag/${workspace}/actions`}
              className="hover:text-ink"
            >
              → 전체 액션 보기
            </a>
            <span className="opacity-40">·</span>
            <a
              href={`/diag/${workspace}/worklist`}
              className="hover:text-ink"
            >
              → 워크리스트 (138 task)
            </a>
            <span className="opacity-40">·</span>
            <a
              href={`/diag/${workspace}/signals`}
              className="hover:text-ink"
            >
              → 시그널 피드
            </a>
          </div>
        </section>
      ) : (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
          <div className="border-2 border-ink-soft/40 bg-paper-soft p-6 sm:p-8 text-center">
            <p className="kicker mb-2">이번 주 할 일</p>
            <p className="font-display text-2xl leading-tight">
              긴급 액션 없음 — 평소 운영을 이어가세요.
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              새 시그널·코치 진단·마감 임박 액션이 생기면 이 자리에 자동으로 나타납니다.
            </p>
            <div className="mt-5 flex justify-center flex-wrap gap-3">
              <a
                href={`/diag/${workspace}/worklist`}
                className="btn-secondary"
              >
                <span className="font-mono text-xs">→</span>
                워크리스트로 이동
              </a>
              {rows.length < 4 ? (
                <a
                  href={`/diag/${workspace}/members`}
                  className="btn-secondary"
                >
                  <span className="font-mono text-xs">→</span>
                  팀원 초대 (현재 {rows.length}명)
                </a>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {/* 도메인 그리드 — 12개, click → coach */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-14">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
          <h2 className="font-display text-2xl sm:text-3xl leading-tight">
            도메인 한눈에
          </h2>
          <span className="label-mono">
            {aggregate.fp["6m"].red_critical_domains.length > 0
              ? `빨강 ${aggregate.fp["6m"].red_critical_domains.length}개 · `
              : ""}
            클릭 → AI 코치
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {framework.domains.map((d) => {
            const ds = aggregate.domain_scores.find((x) => x.domain === d.code);
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
                className={`border-2 bg-paper hover:bg-paper-deep/30 p-3 transition-colors block ${
                  tone === "red"
                    ? "border-signal-red"
                    : tone === "amber"
                      ? "border-signal-amber"
                      : tone === "green"
                        ? "border-signal-green"
                        : "border-ink-soft/40"
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
                    {d.tier === "critical"
                      ? "C"
                      : d.tier === "important"
                        ? "I"
                        : "S"}
                  </span>
                </div>
                <p className="font-display text-3xl mt-1 leading-none">
                  {score === null ? "—" : Math.round(score)}
                </p>
                <p className="label-mono text-[10px] truncate mt-1">
                  {d.name_ko}
                </p>
              </a>
            );
          })}
        </div>
      </section>

      {/* RECENT ACTIVITY — signals + actions 미니 */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-14 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* signals */}
        <div className="border-2 border-ink p-5 sm:p-6">
          <header className="flex items-baseline justify-between mb-3">
            <h3 className="font-display text-xl">최근 시그널</h3>
            <a
              href={`/diag/${workspace}/signals`}
              className="label-mono hover:text-ink"
            >
              전체 →
            </a>
          </header>
          {recentSignals.length === 0 ? (
            <p className="text-sm text-ink-soft">
              아직 시그널이 없습니다. KPI 인입 또는 진단 변동 시 자동 등장.
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
                  <p className="font-mono text-xs leading-snug">
                    {s.narrative}
                  </p>
                  <p className="label-mono mt-0.5">
                    {new Date(s.created_at)
                      .toISOString()
                      .slice(0, 16)
                      .replace("T", " ")}
                    {s.domain_code ? ` · ${s.domain_code}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* actions summary */}
        <div className="border-2 border-ink p-5 sm:p-6">
          <header className="flex items-baseline justify-between mb-3">
            <h3 className="font-display text-xl">액션 보드</h3>
            <a
              href={`/diag/${workspace}/actions`}
              className="label-mono hover:text-ink"
            >
              전체 →
            </a>
          </header>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="진행 중" value={activeActionCount} />
            <Stat
              label="지연"
              value={overdueActions.length}
              tone={overdueActions.length > 0 ? "red" : undefined}
            />
            <Stat
              label="검증 완료"
              value={verifiedCount}
              tone={verifiedCount > 0 ? "green" : undefined}
            />
          </div>
          {overdueActions.length > 0 ? (
            <div className="mt-4 pt-3 border-t border-ink-soft/30">
              <p className="kicker !text-signal-red mb-2">
                OVERDUE · {overdueActions.length}건
              </p>
              <ul className="space-y-1">
                {overdueActions.slice(0, 3).map((a) => {
                  const d = a.deadline ? new Date(a.deadline) : null;
                  const daysOver = d
                    ? Math.ceil(
                        (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000),
                      )
                    : null;
                  return (
                    <li key={a.id} className="text-sm leading-snug">
                      <span className="font-mono text-xs">
                        {a.owner_role ?? "?"} · {daysOver}d 지남
                      </span>{" "}
                      <span className="text-ink-soft">
                        {a.title.slice(0, 50)}
                        {a.title.length > 50 ? "…" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {/* 깊이 보기 — 3 cards */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-14">
        <h2 className="font-display text-2xl sm:text-3xl leading-tight mb-5">
          깊이 보기
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <DeepLink
            href={`/diag/${workspace}/result`}
            kicker="Reality Report"
            title="진단 결과 상세"
            body="요인 8개 분해, 도메인별 점수 breakdown, 응답자 합의도, 워크리스트 임팩트 토글까지."
          />
          <DeepLink
            href={`/diag/${workspace}/worklist`}
            kicker="Worklist"
            title="138개 task 실행"
            body="팀별·단계별 task, 데이터 인입 패널, 자동 derived 신규 task. 실행 → 점수 반영."
          />
          <DeepLink
            href={`/diag/${workspace}/timeline`}
            kicker="Timeline"
            title="분기 변화 비교"
            body="Q-1 → Q → Q+1 진단 점수 추이. 도메인별 sparkline, 액션 효과 검증."
          />
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a href="/diag" className="label-mono hover:text-ink">
          ← 워크스페이스 목록
        </a>
        <p className="label-mono">{ISSUE_DATE} · home v1</p>
      </footer>
    </main>
  );
}

// ============================================================
// Helpers
// ============================================================

const STAGE_LABELS: Record<string, string> = {
  closed_beta: "비공개 베타",
  open_beta: "공개 베타",
  ga_early: "정식 출시 (0–6개월)",
  ga_growth: "성장기 (6–24개월)",
  ga_scale: "확장기 (24개월+)",
  // legacy fallback
  pre_seed: "비공개 베타",
  seed: "공개 베타",
  series_a: "정식 출시 (0–6개월)",
  series_b: "성장기 (6–24개월)",
  series_c_plus: "확장기 (24개월+)",
};

function computeStatus({
  fp_6m,
  overdue,
  redCritical,
  pendingHigh,
}: {
  fp_6m: number;
  overdue: number;
  redCritical: number;
  pendingHigh: number;
}): { tone: "green" | "amber" | "red"; label: string } {
  if (fp_6m >= 0.55 || redCritical >= 2 || overdue >= 3) {
    return { tone: "red", label: "Red zone — 즉각 조치" };
  }
  if (fp_6m >= 0.35 || redCritical >= 1 || overdue >= 1 || pendingHigh >= 2) {
    return { tone: "amber", label: "주의 — 점검 필요" };
  }
  return { tone: "green", label: "On track" };
}

interface ThisWeekItem {
  key: string;
  href: string;
  kind: string;
  title: string;
  subtitle?: string;
  meta: string;
  tone: "red" | "amber" | "neutral";
  priority: number;
}

function buildThisWeekList(
  dueSoonActions: ActionRow[],
  highSeverity: ProactiveSession[],
  framework: ReturnType<typeof loadFramework>,
  workspace: string,
  now: number,
): ThisWeekItem[] {
  const items: ThisWeekItem[] = [];

  for (const a of dueSoonActions) {
    const ms = a.deadline ? new Date(a.deadline).getTime() - now : 0;
    const days = Math.round(ms / (24 * 60 * 60 * 1000));
    const overdue = ms < 0;
    items.push({
      key: `action:${a.id}`,
      href: `/diag/${workspace}/actions`,
      kind: "액션",
      title: a.title,
      subtitle: a.owner_role
        ? `담당: ${a.owner_role}`
        : "담당자 미지정 — 클릭해서 지정",
      meta: overdue
        ? `${Math.abs(days)}일 지연`
        : days === 0
          ? "오늘 마감"
          : `D-${days}`,
      tone: overdue ? "red" : days <= 2 ? "red" : "amber",
      priority: overdue ? -1000 + days : days,
    });
  }

  for (const f of highSeverity) {
    const dom = framework.domains.find((d) => d.code === f.domain_code);
    items.push({
      key: `finding:${f.id}`,
      href: `/diag/${workspace}/coach/${f.domain_code}`,
      kind: "긴급 코칭",
      title: f.summary ?? `${dom?.name_ko ?? f.domain_code} 영역 점검`,
      subtitle: dom
        ? `${f.domain_code} · ${dom.name_ko} — 코치와 SMART 액션 채택`
        : "코치 화면에서 SMART 액션 채택",
      meta: `severity ${f.severity}`,
      tone: "red",
      priority: -500 - f.severity,
    });
  }

  items.sort((a, b) => a.priority - b.priority);
  return items.slice(0, 3);
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red" | "green";
}) {
  return (
    <div>
      <p
        className={`font-display text-3xl leading-none ${
          tone === "red"
            ? "text-signal-red"
            : tone === "green"
              ? "text-signal-green"
              : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="label-mono mt-1">{label}</p>
    </div>
  );
}

function DeepLink({
  href,
  kicker,
  title,
  body,
}: {
  href: string;
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <a
      href={href}
      className="border-2 border-ink p-5 hover:bg-paper-deep/30 transition-colors block"
    >
      <p className="kicker mb-2">{kicker}</p>
      <h3 className="font-display text-xl leading-tight">{title}</h3>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">{body}</p>
      <p className="mt-3 label-mono">바로가기 →</p>
    </a>
  );
}

// ============================================================
// Aggregate (subset of result/page.tsx logic)
// ============================================================

function aggregateRespondents(
  framework: ReturnType<typeof loadFramework>,
  rows: DiagRow[],
): {
  overall: number | null;
  domain_scores: DomainScoreResult[];
  fp: ReturnType<typeof computeFailureProbability>;
  stage: Stage;
} {
  const subDefs: SubItemDef[] = framework.domains.flatMap((d) =>
    d.groups.flatMap((g) =>
      g.sub_items.map((s) => ({
        code: s.code,
        domain: d.code,
        group: g.code,
        tier: s.tier,
        weight_within_group: s.weight_within_group,
        data_quality_required: (s.data_quality_required ?? 1) as 1 | 2 | 3,
        reverse_scoring: s.reverse_scoring,
      })),
    ),
  );
  const subDefMap = new Map(subDefs.map((s) => [s.code, s]));

  const responses: SubItemResponse[] = [];
  for (const row of rows) {
    if (!row.responses) continue;
    for (const [code, r] of Object.entries(row.responses)) {
      if (!subDefMap.has(code)) continue;
      if (!r.belief) continue;
      responses.push({
        sub_item_code: code,
        respondent_id: `r${row.respondent_num}`,
        belief: r.belief as 1 | 2 | 3 | 4 | 5,
        evidence:
          r.na || r.evidence === null || r.evidence === undefined
            ? null
            : (r.evidence as 1 | 2 | 3 | 4 | 5),
        evidence_recorded_at: new Date(r.evidence_recorded_at),
      });
    }
  }

  const now = new Date();
  const subScoresPerRespondent = new Map<
    string,
    Map<string, ReturnType<typeof computeSubItemScore>>
  >();
  for (const r of responses) {
    const def = subDefMap.get(r.sub_item_code);
    if (!def) continue;
    const score = computeSubItemScore(r, def, now);
    if (!subScoresPerRespondent.has(r.respondent_id)) {
      subScoresPerRespondent.set(r.respondent_id, new Map());
    }
    subScoresPerRespondent.get(r.respondent_id)!.set(r.sub_item_code, score);
  }

  const subScoreAvg = new Map<
    string,
    ReturnType<typeof computeSubItemScore>
  >();
  for (const def of subDefs) {
    const scores: number[] = [];
    let representativeFlag: ReturnType<typeof computeSubItemScore>["flag"];
    for (const map of subScoresPerRespondent.values()) {
      const r = map.get(def.code);
      if (!r) continue;
      if (r.score !== null) scores.push(r.score);
      if (r.flag) representativeFlag = r.flag;
    }
    if (scores.length === 0) continue;
    const consensus = computeConsensus(scores);
    subScoreAvg.set(def.code, {
      score: consensus?.reported_score ?? null,
      penalty: 0,
      flag: representativeFlag,
      belief_normalized: 0,
      evidence_normalized: null,
    });
  }

  const groupDefs: GroupDef[] = framework.domains.flatMap((d) => {
    const cnt = d.groups.length || 1;
    return d.groups.map((g) => ({
      code: g.code,
      domain: d.code,
      weight_within_domain: 1 / cnt,
      is_critical: g.sub_items.some((s) => s.tier === "critical"),
    }));
  });
  const subDefsByGroup = new Map<string, SubItemDef[]>();
  for (const s of subDefs) {
    const list = subDefsByGroup.get(s.group);
    if (list) list.push(s);
    else subDefsByGroup.set(s.group, [s]);
  }

  const groupScoreMap = new Map<
    string,
    ReturnType<typeof computeGroupScore>
  >();
  for (const [code, defs] of subDefsByGroup.entries()) {
    const groupDef = groupDefs.find((g) => g.code === code);
    if (!groupDef) continue;
    groupScoreMap.set(code, computeGroupScore(groupDef, defs, subScoreAvg));
  }

  const domain_scores = framework.domains.map((d) => {
    const responded = new Set(responses.map((r) => r.sub_item_code));
    const missingPenalty =
      d.groups
        .flatMap((g) => g.sub_items)
        .filter(
          (s) =>
            !responded.has(s.code) && (s.data_quality_required ?? 1) >= 2,
        ).length * -8;
    return computeDomainScore(
      { code: d.code, weight: d.weight, tier: d.tier },
      groupDefs.filter((g) => g.domain === d.code),
      groupScoreMap,
      missingPenalty,
      d.thresholds,
    );
  });

  const domainDefs: DomainDef[] = framework.domains.map((d) => ({
    code: d.code,
    weight: d.weight,
    tier: d.tier,
  }));
  const overall = computeOverallScore(domain_scores, domainDefs);
  const stage = (rows[rows.length - 1]?.stage as Stage) ?? "open_beta";

  const fp = computeFailureProbability(
    domain_scores,
    domainDefs,
    responses,
    stage,
    undefined,
    {
      subDefs,
      now,
      respondentCount: rows.length,
    },
  );

  return { overall, domain_scores, fp, stage };
}

// ============================================================
// Empty / first-visit views
// ============================================================

function FirstVisitView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">새 워크스페이스</p>
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

function NoDiagYet({
  workspace,
  currentUser,
  alreadyMember,
  memberRole,
}: {
  workspace: string;
  currentUser: { email?: string | null; id: string } | null;
  alreadyMember: boolean;
  memberRole: string | null;
}) {
  return (
    <main className="min-h-dvh w-full pb-24">
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-5 flex items-baseline justify-between gap-6 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap">
            <a href="/diag" className="kicker hover:text-ink">
              ← 워크스페이스 목록
            </a>
            <span className="hidden sm:inline label-mono opacity-50">·</span>
            <span className="hidden sm:inline label-mono">{workspace}</span>
          </div>
          <div className="flex items-center gap-3">
            <ClaimButton
              workspace={workspace}
              authed={!!currentUser}
              alreadyMember={alreadyMember}
              role={memberRole}
              email={currentUser?.email ?? null}
            />
            <span className="label-mono">HOME</span>
          </div>
        </div>
      </header>
      <section className="max-w-3xl mx-auto px-6 sm:px-10 pt-20 text-center">
        <p className="kicker mb-3">No. 01 · 시작하기</p>
        <h1 className="font-display text-5xl sm:text-6xl leading-tight">
          진단부터 시작하세요
        </h1>
        <p className="mt-5 text-lg text-ink-soft leading-relaxed">
          이 워크스페이스(<span className="font-mono">{workspace}</span>)는 아직 응답이 없습니다.
          12개 도메인 진단(약 20–30분)을 마치면 종합 건강도·6/12개월 실패확률 ·도메인별 점수가
          자동 계산되고, 빨간 도메인은 AI 코치가 SMART 액션을 제안합니다.
        </p>
        <a
          href={`/diag/${workspace}`}
          className="btn-primary mt-8 inline-flex"
        >
          진단 시작 <span className="font-mono text-xs">→</span>
        </a>
      </section>
    </main>
  );
}

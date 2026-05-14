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
import { STAGE_LABEL_SHORT } from "@/lib/stage-labels";
import { fetchWorkspaceTimeline } from "@/lib/agents/timeline-context";
import { getCurrentUser } from "@/lib/supabase/auth";
import { ClaimButton } from "./_claim-button";
import {
  type Stage,
  type DomainScoreResult,
  type computeFailureProbability,
} from "@/lib/scoring";
import {
  isStaleFinanceContent,
  isRemovedDomain,
} from "@/lib/stale-content-filter";
import { aggregateRespondents } from "@/lib/diagnosis-aggregate";
import { fetchDiagnosisProfile } from "@/lib/diagnosis-profile/server-fetch";

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

  // diagnosis 응답 존재 여부를 먼저 판단 (org row 없어도 진단 데이터가 있으면 렌더링).
  // 이전엔 org 가 null 이면 즉시 FirstVisitView 로 빠져, ensureWorkspaceOrg 가 실패한
  // 워크스페이스에서 "진단을 한 적이 없습니다" 가 잘못 떴음.
  const [diagRes, org] = await Promise.all([
    sb
      .from("diagnosis_responses")
      .select(
        "id, workspace_id, respondent_num, role, perspective, stage, responses, result, completed_at",
      )
      .eq("workspace_id", workspace)
      .order("respondent_num", { ascending: true }),
    resolveOrgWithBackfill(sb, workspace),
  ]);

  const rows = (diagRes.data ?? []) as DiagRow[];

  // 진짜 비어있는 워크스페이스: 진단도 없고 org 도 없음
  if (rows.length === 0 && !org) {
    return <FirstVisitView workspace={workspace} />;
  }

  // 진단이 0건이면 (org 만 있어도) NoDiagYet
  if (rows.length === 0) {
    const currentUser = await getCurrentUser();
    return (
      <NoDiagYet
        workspace={workspace}
        currentUser={currentUser}
        alreadyMember={false}
        memberRole={null}
      />
    );
  }

  // 여기서부터는 진단 데이터가 있음. org 가 없으면 org-scoped 데이터(시그널·액션·코치)는
  // 비어 있게 처리하고, 진단 점수·요인 분해는 정상 렌더링.
  const currentUser = await getCurrentUser();
  let alreadyMember = false;
  let memberRole: string | null = null;
  if (org && currentUser) {
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

  // Parallel fetch (org 없으면 빈 배열)
  const [proactiveRes, actionsRes, signalsRes] = org
    ? await Promise.all([
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
      ])
    : [
        { data: [] as ProactiveSession[] },
        { data: [] as ActionRow[] },
        { data: [] as SignalRow[] },
      ];

  const framework = loadFramework();
  const { injectActiveSurveyResults } = await import(
    "@/lib/surveys/inject"
  );
  const surveyInjections = await injectActiveSurveyResults(workspace).catch(
    () => [],
  );
  // 운영 컨텍스트 기반 적응 프로필 — 점수·실패확률에 T1 가중치, T3 추가 카드,
  // inactive 면제 적용. OpsContext 없으면 null (기본 frame 사용 — 적응 없음).
  const adaptationProfile = await fetchDiagnosisProfile(workspace);
  const aggregate = aggregateRespondents(
    framework,
    rows,
    surveyInjections,
    adaptationProfile,
  );

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
              ← 진단 카드 목록
            </a>
            <span className="hidden sm:inline label-mono opacity-50">·</span>
            <span className="hidden sm:inline label-mono">{workspace}</span>
            {currentUser ? (
              <>
                <span className="hidden sm:inline label-mono opacity-50">·</span>
                <span className="label-mono">
                  {currentUser.email?.split("@")[0]}
                </span>
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

      {/* HERO — 편집디자인 풍으로. 박스 없이 타이포그래피·룰·그리드로 구성. */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-14 pb-12">
        <div className="flex items-baseline gap-3 mb-6 flex-wrap">
          <span className="kicker">
            <span className="section-num">No. </span>01
          </span>
          <span className="label-mono opacity-50">·</span>
          <span className="kicker !text-ink-soft">현재 상태</span>
          <span className="label-mono opacity-50">·</span>
          <span className="label-mono">
            응답자 {rows.length}명 · {stageLabel}
          </span>
        </div>

        <h1 className="font-display text-4xl sm:text-6xl leading-[1.05] tracking-tight break-keep mb-6">
          지금,{" "}
          <span className="font-mono text-3xl sm:text-5xl break-all align-baseline">
            {workspace}
          </span>
          <br />
          <span className="italic font-light">는</span>{" "}
          <span
            className={`${
              status.tone === "green"
                ? "text-signal-green"
                : status.tone === "amber"
                  ? "text-signal-amber"
                  : "text-signal-red"
            }`}
          >
            {status.tone === "green"
              ? "양호"
              : status.tone === "amber"
                ? "주의"
                : "위험"}
          </span>{" "}
          상태입니다.
        </h1>

        {/* Editorial split — 7/5 비대칭. 박스 없음, 가운데 dotted rule 만. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 mt-10">
          {/* 좌: 종합 건강도 — display 숫자 자체가 시각적 무게중심 */}
          <div className="lg:col-span-7">
            <p className="kicker mb-3">종합 건강도</p>
            <p className="font-display leading-[0.9] tracking-tight">
              <span
                className={`text-8xl sm:text-[9rem] ${
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
              <span className="text-3xl text-ink-soft font-light tracking-wider">
                {" "}
                / 100
              </span>
            </p>
            <p className="mt-6 text-base sm:text-lg leading-relaxed text-ink-soft max-w-xl">
              {aggregate.overall === null
                ? "응답이 부족해 정확한 판정이 어렵습니다. 진단을 시작하거나 팀원 응답을 모아보세요."
                : aggregate.overall >= 70
                  ? "임계값 위에 있는 영역이 다수입니다. 정기 점검 케이던스를 유지하면서 노란 영역이 빨강으로 떨어지지 않도록 관리하세요."
                  : aggregate.overall >= 40
                    ? "핵심 영역 일부가 임계값 아래로 내려갔습니다. 빨강·노랑 영역의 코치 페이지에서 SMART 액션부터 채택하세요."
                    : "다수의 핵심 영역이 빨강입니다. 단일 영역만의 문제가 아니라 다층 점검이 필요한 단계 — 우선순위 1·2번 도메인을 이번 주 안에 시작하세요."}
            </p>
          </div>

          {/* 우: 어려움 가능성 — 좌측 룰로 구분. 박스 대신 vertical rule */}
          <div className="lg:col-span-5 lg:border-l lg:border-ink-soft/40 lg:pl-12 border-t pt-8 lg:pt-0 lg:border-t-0">
            <p className="kicker mb-4">어려움 가능성</p>

            <div className="space-y-5">
              <div>
                <div className="flex items-baseline gap-3">
                  <p
                    className={`font-display text-6xl leading-none tracking-tight ${
                      fp6m >= 0.45
                        ? "text-signal-red"
                        : fp6m >= 0.25
                          ? "text-signal-amber"
                          : "text-signal-green"
                    }`}
                  >
                    {Math.round(fp6m * 100)}
                    <span className="text-2xl text-ink-soft font-light">%</span>
                  </p>
                  <span className="label-mono">6개월</span>
                </div>
                <p className="mt-1 label-mono">
                  prior {Math.round(aggregate.fp["6m"].prior * 100)}%
                  {fp6m > aggregate.fp["6m"].prior * 1.2
                    ? " · 진단으로 위험↑"
                    : fp6m < aggregate.fp["6m"].prior * 0.8
                      ? " · 진단으로 위험↓"
                      : " · prior 수준"}
                </p>
              </div>

              <div className="dotted-rule" />

              <div>
                <div className="flex items-baseline gap-3">
                  <p
                    className={`font-display text-5xl leading-none tracking-tight ${
                      aggregate.fp["12m"].final >= 0.55
                        ? "text-signal-red"
                        : aggregate.fp["12m"].final >= 0.35
                          ? "text-signal-amber"
                          : "text-signal-green"
                    }`}
                  >
                    {Math.round(aggregate.fp["12m"].final * 100)}
                    <span className="text-xl text-ink-soft font-light">%</span>
                  </p>
                  <span className="label-mono">12개월</span>
                </div>
                <p className="mt-1 label-mono">
                  prior {Math.round(aggregate.fp["12m"].prior * 100)}%
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 하단 메타 라인 — 박스 없이 dotted rule + 텍스트 */}
        <div className="mt-12 pt-4 border-t border-ink-soft/30 flex items-baseline justify-between flex-wrap gap-3">
          <p className="label-mono">
            ⓘ Bayesian 8요인 log-LR 모델 · stage prior × 진단 가중치
          </p>
          <a
            href={`/diag/${workspace}/result`}
            className="label-mono hover:text-ink underline-offset-2 hover:underline"
          >
            요인 분해 + 도메인 breakdown 보기 →
          </a>
        </div>
      </section>

      {/* QUARTERLY DUE — 90일 경과. 박스 대신 좌측 굵은 룰 */}
      {quarterlyDue ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="border-l-4 border-signal-amber pl-5 py-2 flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="kicker mb-1 !text-signal-amber">
                Quarterly review · {daysSinceLatest}일 경과
              </p>
              <h2 className="font-display text-xl sm:text-2xl leading-tight">
                지난 분기 진단 —{" "}
                <span className="italic font-light">재응답을 권장합니다.</span>
              </h2>
              <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                90일 이상 경과하면 KPI/팀/시장 변동이 반영되지 않아 코치
                정확도가 떨어집니다.
              </p>
            </div>
            <a href={`/diag/${workspace}`} className="btn-primary">
              재진단 시작 <span className="font-mono text-xs">→</span>
            </a>
          </div>
        </section>
      ) : null}

      {/* 이번 주 할 일 — 편집디자인. 두꺼운 룰 + 챕터 번호 + 큰 숫자 인덱스 */}
      {thisWeek.length > 0 ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-4">
          <div className="border-t-2 border-ink pt-8">
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
              <p className="kicker">
                <span className="section-num">No. </span>03 · 이번 주
              </p>
              <span className="label-mono">
                지연 {overdueActions.length} · 7일 내 마감{" "}
                {dueSoonActions.length - overdueActions.length} · 긴급 코칭{" "}
                {highSeverity.length}
              </span>
            </div>
            <h2 className="font-display text-3xl sm:text-5xl leading-[1.05] tracking-tight break-keep mb-3">
              이번 주, 우리 팀이{" "}
              <span className="italic font-light">할 일.</span>
            </h2>
            <p className="text-base sm:text-lg text-ink-soft leading-relaxed max-w-2xl">
              점수가 아니라 액션이 변화의 단위입니다. 아래 항목을 하나씩
              마감하면 다음 주 이 자리에 더 적은 항목이 남습니다.
            </p>
          </div>

          <ol className="mt-8 divide-y divide-ink-soft/30 border-y border-ink-soft/30">
            {thisWeek.map((item, i) => (
              <li key={item.key}>
                <a
                  href={item.href}
                  className="flex items-start gap-5 sm:gap-7 py-5 hover:bg-paper-soft/50 px-2 -mx-2 transition-colors group"
                >
                  <span
                    className={`font-display text-5xl sm:text-6xl leading-none tabular-nums shrink-0 w-12 sm:w-14 ${
                      item.tone === "red"
                        ? "text-signal-red"
                        : item.tone === "amber"
                          ? "text-signal-amber"
                          : "text-accent"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span
                        className={`label-mono uppercase tracking-widest ${
                          item.tone === "red"
                            ? "!text-signal-red"
                            : item.tone === "amber"
                              ? "!text-signal-amber"
                              : ""
                        }`}
                      >
                        {item.kind}
                      </span>
                      <span className="label-mono">· {item.meta}</span>
                    </div>
                    <p className="mt-2 font-display text-xl sm:text-2xl leading-snug">
                      {item.title}
                    </p>
                    {item.subtitle ? (
                      <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-3xl">
                        {item.subtitle}
                      </p>
                    ) : null}
                  </div>
                  <span className="font-mono text-base text-ink-soft shrink-0 self-center group-hover:text-ink transition-colors">
                    →
                  </span>
                </a>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 label-mono">
            <a
              href={`/diag/${workspace}/actions`}
              className="hover:text-ink underline-offset-2 hover:underline"
            >
              → 전체 액션 보기
            </a>
            <a
              href={`/diag/${workspace}/worklist`}
              className="hover:text-ink underline-offset-2 hover:underline"
            >
              → 워크리스트
            </a>
            <a
              href={`/diag/${workspace}/signals`}
              className="hover:text-ink underline-offset-2 hover:underline"
            >
              → 시그널 피드
            </a>
          </div>
        </section>
      ) : (
        <DiagnosisSummarySection
          workspace={workspace}
          aggregate={aggregate}
          framework={framework}
          rows={rows}
          status={status}
          stageLabel={stageLabel}
          highSeverity={highSeverity}
          recentSignals={recentSignals}
          activeActionCount={activeActionCount}
          verifiedCount={verifiedCount}
        />
      )}

      {/* 도메인 한눈에 — 편집디자인 리스트. 박스 그리드가 아니라 룰로 구분된 행. */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-4">
        <div className="border-t-2 border-ink pt-8 mb-6 flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <p className="kicker mb-1">
              <span className="section-num">No. </span>02
            </p>
            <h2 className="font-display text-3xl sm:text-4xl leading-tight tracking-tight">
              도메인 한눈에
            </h2>
          </div>
          <span className="label-mono">
            {aggregate.fp["6m"].red_critical_domains.length > 0
              ? `빨강 ${aggregate.fp["6m"].red_critical_domains.length}개 · `
              : ""}
            클릭 → AI 코치
          </span>
        </div>

        <ul className="divide-y divide-ink-soft/30 border-y border-ink-soft/30">
          {framework.domains
            .slice()
            .sort((a, b) => {
              // critical 먼저, 그 다음 점수 낮은 순
              const tierOrder = { critical: 0, important: 1, supporting: 2 };
              const ta = tierOrder[a.tier as keyof typeof tierOrder] ?? 3;
              const tb = tierOrder[b.tier as keyof typeof tierOrder] ?? 3;
              if (ta !== tb) return ta - tb;
              const sa =
                aggregate.domain_scores.find((x) => x.domain === a.code)
                  ?.score ?? 100;
              const sb =
                aggregate.domain_scores.find((x) => x.domain === b.code)
                  ?.score ?? 100;
              return sa - sb;
            })
            .map((d) => {
              const ds = aggregate.domain_scores.find(
                (x) => x.domain === d.code,
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
              const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
              return (
                <li key={d.code}>
                  <a
                    href={`/diag/${workspace}/coach/${d.code}`}
                    className="grid grid-cols-12 items-center gap-3 py-3.5 hover:bg-paper-soft/50 px-2 -mx-2 transition-colors group"
                  >
                    {/* 코드 */}
                    <span className="col-span-2 sm:col-span-1 font-mono text-sm text-ink-soft tabular-nums">
                      {d.code}
                    </span>

                    {/* 이름 + tier */}
                    <span className="col-span-7 sm:col-span-5 min-w-0">
                      <span className="font-display text-base sm:text-lg leading-tight block truncate">
                        {d.name_ko}
                      </span>
                      <span className="label-mono">
                        {d.tier === "critical"
                          ? "critical"
                          : d.tier === "important"
                            ? "important"
                            : "supporting"}{" "}
                        · 가중치 {d.weight}%
                      </span>
                    </span>

                    {/* 점수 바 — 박스 대신 가로 막대 */}
                    <span className="hidden sm:flex col-span-3 items-center gap-2">
                      <span className="flex-1 h-1.5 bg-paper-deep relative overflow-hidden">
                        <span
                          className={`absolute inset-y-0 left-0 ${
                            tone === "red"
                              ? "bg-signal-red"
                              : tone === "amber"
                                ? "bg-signal-amber"
                                : tone === "green"
                                  ? "bg-signal-green"
                                  : "bg-ink-soft/40"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    </span>

                    {/* 점수 숫자 */}
                    <span
                      className={`col-span-2 sm:col-span-2 text-right font-display text-xl sm:text-2xl leading-none tabular-nums ${
                        tone === "red"
                          ? "text-signal-red"
                          : tone === "amber"
                            ? "text-signal-amber"
                            : tone === "green"
                              ? "text-signal-green"
                              : "text-ink-soft"
                      }`}
                    >
                      {score === null ? "—" : Math.round(score)}
                    </span>

                    {/* 화살표 */}
                    <span className="col-span-1 text-right font-mono text-base text-ink-soft group-hover:text-ink transition-colors">
                      →
                    </span>
                  </a>
                </li>
              );
            })}
        </ul>
        <p className="mt-3 label-mono">
          중요도(critical → important → supporting) · 점수 낮은 순 정렬
        </p>
      </section>

      {/* RECENT ACTIVITY — 박스 없이 2-col, 가운데 vertical rule */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-4">
        <div className="border-t-2 border-ink pt-8 mb-6 flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <p className="kicker mb-1">
              <span className="section-num">No. </span>04
            </p>
            <h2 className="font-display text-3xl sm:text-4xl leading-tight tracking-tight">
              최근 흐름
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* 시그널 */}
          <div className="lg:col-span-7">
            <div className="flex items-baseline justify-between mb-4">
              <p className="kicker">최근 시그널</p>
              <a
                href={`/diag/${workspace}/signals`}
                className="label-mono hover:text-ink underline-offset-2 hover:underline"
              >
                전체 →
              </a>
            </div>
            {recentSignals.length === 0 ? (
              <p className="text-sm text-ink-soft leading-relaxed">
                아직 시그널이 없습니다. KPI 인입 또는 진단 변동 시 자동 등장합니다.
              </p>
            ) : (
              <ul className="divide-y divide-ink-soft/30">
                {recentSignals.slice(0, 5).map((s) => (
                  <li key={s.id} className="py-3.5 flex items-baseline gap-4">
                    <span
                      className={`font-mono text-xs shrink-0 w-2 self-stretch ${
                        s.severity >= 4
                          ? "bg-signal-red"
                          : s.severity >= 3
                            ? "bg-signal-amber"
                            : "bg-ink-soft/30"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{s.narrative}</p>
                      <p className="label-mono mt-1">
                        {new Date(s.created_at)
                          .toISOString()
                          .slice(0, 16)
                          .replace("T", " ")}
                        {s.domain_code ? ` · ${s.domain_code}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 액션 — 좌측 룰로 분리 */}
          <div className="lg:col-span-5 lg:border-l lg:border-ink-soft/40 lg:pl-12 border-t pt-8 lg:pt-0 lg:border-t-0">
            <div className="flex items-baseline justify-between mb-4">
              <p className="kicker">액션 보드</p>
              <a
                href={`/diag/${workspace}/actions`}
                className="label-mono hover:text-ink underline-offset-2 hover:underline"
              >
                전체 →
              </a>
            </div>
            <div className="grid grid-cols-3 divide-x divide-ink-soft/30 border-y border-ink-soft/30 py-4">
              <StatInline label="진행 중" value={activeActionCount} />
              <StatInline
                label="지연"
                value={overdueActions.length}
                tone={overdueActions.length > 0 ? "red" : undefined}
              />
              <StatInline
                label="검증 완료"
                value={verifiedCount}
                tone={verifiedCount > 0 ? "green" : undefined}
              />
            </div>
            {overdueActions.length > 0 ? (
              <div className="mt-5 border-l-2 border-signal-red pl-4">
                <p className="kicker !text-signal-red mb-2">
                  Overdue · {overdueActions.length}건
                </p>
                <ul className="space-y-2">
                  {overdueActions.slice(0, 3).map((a) => {
                    const d = a.deadline ? new Date(a.deadline) : null;
                    const daysOver = d
                      ? Math.ceil(
                          (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000),
                        )
                      : null;
                    return (
                      <li key={a.id} className="text-sm leading-snug">
                        <span className="font-mono text-xs text-signal-red">
                          {a.owner_role ?? "?"} · {daysOver}d 지남
                        </span>
                        <span className="text-ink-soft block">
                          {a.title.slice(0, 60)}
                          {a.title.length > 60 ? "…" : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* 깊이 보기 — 박스 없는 편집디자인 3-col. 룰로 구분 */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-4">
        <div className="border-t-2 border-ink pt-8 mb-6">
          <p className="kicker mb-1">
            <span className="section-num">No. </span>05
          </p>
          <h2 className="font-display text-3xl sm:text-4xl leading-tight tracking-tight">
            깊이 보기
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:divide-x divide-ink-soft/30">
          <a
            href={`/diag/${workspace}/result`}
            className="group block md:pr-6 first:md:pr-6"
          >
            <p className="kicker mb-2">Reality Report</p>
            <h3 className="font-display text-xl sm:text-2xl leading-tight mb-2 group-hover:text-accent transition-colors">
              진단 결과 상세 <span className="font-mono text-sm">→</span>
            </h3>
            <p className="text-sm text-ink-soft leading-relaxed">
              요인 8개 분해, 도메인별 점수 breakdown, 응답자 합의도, 워크리스트
              임팩트 토글까지.
            </p>
          </a>
          <a
            href={`/diag/${workspace}/worklist`}
            className="group block md:pl-6 md:pr-6"
          >
            <p className="kicker mb-2">Worklist</p>
            <h3 className="font-display text-xl sm:text-2xl leading-tight mb-2 group-hover:text-accent transition-colors">
              팀별 실행 체크리스트 <span className="font-mono text-sm">→</span>
            </h3>
            <p className="text-sm text-ink-soft leading-relaxed">
              팀별·단계별 task, 데이터 인입 패널, 자동 derived 신규 task.
              실행 → 점수 반영.
            </p>
          </a>
          <a
            href={`/diag/${workspace}/timeline`}
            className="group block md:pl-6"
          >
            <p className="kicker mb-2">Timeline</p>
            <h3 className="font-display text-xl sm:text-2xl leading-tight mb-2 group-hover:text-accent transition-colors">
              분기 변화 비교 <span className="font-mono text-sm">→</span>
            </h3>
            <p className="text-sm text-ink-soft leading-relaxed">
              Q-1 → Q → Q+1 진단 점수 추이. 도메인별 sparkline, 액션 효과
              검증.
            </p>
          </a>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-20 pt-6 border-t border-ink-soft flex flex-wrap items-baseline justify-between gap-4">
        <a href="/diag" className="label-mono hover:text-ink">
          ← 진단 카드 목록
        </a>
        <p className="label-mono">
          Set in Fraunces, Pretendard &amp; JetBrains Mono · {ISSUE_DATE}
        </p>
      </footer>
    </main>
  );
}

// ============================================================
// Helpers
// ============================================================

// STAGE_LABELS — uses shared STAGE_LABEL_SHORT (with period suffix).
const STAGE_LABELS: Record<string, string> = STAGE_LABEL_SHORT;

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

// aggregateRespondents 는 src/lib/diagnosis-aggregate.ts 에서 import.
// 카드(`/diag`) 와 홈(`/diag/{ws}/home`) 점수 일치 위해 공통 헬퍼 사용.

// ============================================================
// Empty / first-visit views
// ============================================================

function FirstVisitView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">새 진단 카드</p>
        <h1 className="font-display text-3xl leading-tight">
          이 카드는 아직 진단을 한 적이 없습니다
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
              ← 진단 카드 목록
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
          이 카드(<span className="font-mono">{workspace}</span>)는 아직 응답이 없습니다.
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

// ============================================================
// 진단 카드 총평 — "긴급 액션 없음" 빈 상태 대신 노출되는 디테일한 카드 분석.
// 입력 데이터를 다층적으로 풀어서 운영진이 이 진단 카드의 현재 상태를 한
// 자리에서 깊이 이해할 수 있게 만든다.
// ============================================================

function DiagnosisSummarySection({
  workspace,
  aggregate,
  framework,
  rows,
  status,
  stageLabel,
  highSeverity,
  recentSignals,
  activeActionCount,
  verifiedCount,
}: {
  workspace: string;
  aggregate: ReturnType<typeof aggregateRespondents>;
  framework: ReturnType<typeof loadFramework>;
  rows: DiagRow[];
  status: { tone: "green" | "amber" | "red"; label: string };
  stageLabel: string;
  highSeverity: ProactiveSession[];
  recentSignals: SignalRow[];
  activeActionCount: number;
  verifiedCount: number;
}) {
  const overall = aggregate.overall;
  const fp6 = aggregate.fp["6m"];
  const fp12 = aggregate.fp["12m"];

  // Domain breakdown — name 매핑 + tone 분류
  type DomainView = {
    code: string;
    name: string;
    tier: "critical" | "important" | "supporting";
    weight: number;
    score: number | null;
    tone: "red" | "amber" | "green" | "neutral";
    band: "red" | "amber" | "green" | "neutral";
  };
  const domainViews: DomainView[] = framework.domains.map((d) => {
    const ds = aggregate.domain_scores.find((x) => x.domain === d.code);
    const score = ds?.score ?? null;
    let tone: DomainView["tone"] = "neutral";
    if (score !== null) {
      if (score < d.thresholds.red) tone = "red";
      else if (score < d.thresholds.yellow) tone = "amber";
      else tone = "green";
    }
    return {
      code: d.code,
      name: d.name_ko,
      tier: d.tier as DomainView["tier"],
      weight: d.weight,
      score,
      tone,
      band: tone,
    };
  });

  const redDomains = domainViews
    .filter((d) => d.tone === "red")
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100));
  const amberDomains = domainViews
    .filter((d) => d.tone === "amber")
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100));
  const greenDomains = domainViews
    .filter((d) => d.tone === "green")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const respondedDomains = domainViews.filter((d) => d.score !== null).length;

  // 응답 신선도·데이터 품질 — factor_contributions 에서 추출
  const factor = (name: string) =>
    fp6.factor_contributions.find((f) => f.factor === name);
  const fDataQuality = factor("data_quality");
  const fFreshness = factor("data_freshness");
  const fDelusion = factor("delusion_gap");
  const fConsensus = factor("consensus_disagreement");
  const fMissingEvidence = factor("missing_critical_evidence");

  const topRiskFactors = [...fp6.factor_contributions]
    .filter((f) => f.log_lr > 0.15)
    .sort((a, b) => b.log_lr - a.log_lr)
    .slice(0, 3);
  const topProtectiveFactors = [...fp6.factor_contributions]
    .filter((f) => f.log_lr < -0.1)
    .sort((a, b) => a.log_lr - b.log_lr)
    .slice(0, 3);

  // 한국어 내러티브 — 점수·확률 해석
  const overallNarrative = (() => {
    if (overall === null) return "응답이 부족합니다.";
    if (overall >= 75)
      return "양호한 운영 상태입니다. 빨간 영역이 없거나 매우 적고, 핵심 도메인이 모두 임계값 위에 있습니다. 평소 운영 케이던스를 유지하면 됩니다.";
    if (overall >= 60)
      return "전반적으로 안정적이지만 몇몇 영역이 임계값에 근접합니다. 노란 영역을 빨강으로 떨어뜨리지 않는 데 집중하세요.";
    if (overall >= 45)
      return "주의 단계입니다. 핵심 도메인 중 일부가 빨강·노랑 영역에 있어 6개월 이내 어려움 가능성이 높아진 상태입니다. 이번 주 안에 책임자 지정과 액션 채택이 필요합니다.";
    if (overall >= 30)
      return "위험 단계입니다. 다수의 critical 도메인이 빨강이라 단독으로도 사업 지속 가능성을 크게 떨어뜨립니다. 우선순위 1·2개 도메인 코치를 즉시 시작하세요.";
    return "심각 단계입니다. 핵심 도메인 거의 전부가 빨강이라 일반적인 점진 개선으론 회복이 어렵습니다. 1주일 안에 외부 자문(법률·규제·CS) 동반 검토를 권장합니다.";
  })();

  const fpNarrative = (() => {
    const p6 = Math.round(fp6.final * 100);
    const p12 = Math.round(fp12.final * 100);
    const prior6 = Math.round(fp6.prior * 100);
    if (fp6.final > fp6.prior * 1.3) {
      return `현재 진단 결과가 비슷한 단계 회사 평균(${prior6}%)보다 위험 신호를 더 많이 보내고 있어, 6개월 어려움 가능성이 ${p6}% 로 올라갔습니다. 12개월 기준으로는 ${p12}% 입니다.`;
    }
    if (fp6.final < fp6.prior * 0.85) {
      return `현재 진단이 비슷한 단계 회사 평균(${prior6}%)보다 양호해서, 6개월 어려움 가능성이 ${p6}% 로 내려왔습니다. 12개월 기준 ${p12}%.`;
    }
    return `6개월 어려움 가능성 ${p6}% · 12개월 ${p12}% — 비슷한 단계 회사 평균(${prior6}% / ${Math.round(fp12.prior * 100)}%)과 비슷한 수준입니다.`;
  })();

  // Belief vs Evidence — delusion gap 한국어 풀이
  const delusionNarrative = fDelusion
    ? fDelusion.log_lr > 0.2
      ? "스스로 평가는 후한데 측정 근거(실측 데이터)가 부족합니다 — '망상 격차'가 큽니다. 다음 진단 전에 KPI·증거 업로드를 늘리세요."
      : "스스로 평가와 실측 데이터의 격차가 작은 편입니다 — 팀이 현실을 객관적으로 보고 있습니다."
    : null;

  return (
    <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-4">
      {/* 챕터 표지 — 박스 없음. 두꺼운 룰 + 챕터 번호 + 풀쿼트 식 헤드라인 */}
      <div className="border-t-2 border-ink pt-8 mb-8">
        <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
          <p className="kicker">
            <span className="section-num">No. </span>03 · 진단 카드 총평
          </p>
          <span className="label-mono">
            {respondedDomains}/{framework.domains.length} 영역 응답 ·{" "}
            {stageLabel}
          </span>
        </div>

        {/* 풀쿼트 식 요약 — 박스 대신 큰 타이포그래피 + accent quote mark */}
        <blockquote className="relative">
          <span className="absolute -left-2 sm:-left-4 -top-4 sm:-top-6 font-display text-7xl sm:text-9xl leading-none text-accent opacity-40 select-none">
            “
          </span>
          <p className="font-display text-2xl sm:text-3xl leading-snug tracking-tight pl-6 sm:pl-10 max-w-4xl">
            {overall === null ? (
              "응답이 부족합니다."
            ) : (
              <>
                종합 건강도{" "}
                <span className="font-medium">{Math.round(overall)}점</span>{" "}
                ·{" "}
                <span className="text-signal-red">{redDomains.length}개</span>{" "}
                영역 빨강 ·{" "}
                <span className="text-signal-amber">
                  {amberDomains.length}개
                </span>{" "}
                노랑.
                <span className="italic font-light text-ink-soft">
                  {" "}
                  {overallNarrative.split(".")[0]}.
                </span>
              </>
            )}
          </p>
        </blockquote>

        {/* 보조 단락 — 어려움 가능성 narrative */}
        <p className="mt-6 text-base sm:text-lg leading-relaxed text-ink-soft max-w-3xl pl-6 sm:pl-10">
          {fpNarrative}
        </p>
      </div>

      {/* 빨강·노랑·초록 — 박스 그리드 X. 컬럼 텍스트 + 좌측 가는 룰만 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-8 mt-10">
        <DomainTierColumn
          tone="red"
          title="빨강"
          subtitle="즉각 조치"
          count={redDomains.length}
          items={redDomains}
          workspace={workspace}
          empty="빨간 영역 없음. 좋은 신호입니다."
        />
        <DomainTierColumn
          tone="amber"
          title="노랑"
          subtitle="점검 필요"
          count={amberDomains.length}
          items={amberDomains}
          workspace={workspace}
          empty="노란 영역 없음."
        />
        <DomainTierColumn
          tone="green"
          title="초록"
          subtitle="강점"
          count={greenDomains.length}
          items={greenDomains}
          workspace={workspace}
          empty="아직 임계값을 넘은 영역이 없습니다. 데이터 보강이 필요합니다."
        />
      </div>

      {/* 핵심 요인 — 박스 없음. 챕터 번호 + 점선 룰 + 좌우 비대칭 그리드 */}
      <div className="mt-16 dotted-rule" />
      <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
        <div className="lg:col-span-4">
          <p className="kicker mb-2">왜 이 숫자가 나왔나</p>
          <h3 className="font-display text-2xl sm:text-3xl leading-tight tracking-tight mb-3">
            어려움 가능성은{" "}
            <span className="italic font-light">8개 요인</span>의 합입니다.
          </h3>
          <p className="text-sm text-ink-soft leading-relaxed">
            Critical 도메인 건강도 · Important 평균 · 데이터 품질 · 응답 신선도
            · 응답자 수 · 자기인식–증거 격차 · 핵심 증거 결측률 · 응답자 합의도
            — 각 요인의 로그–가능도비(log-LR) 합으로 prior 를 보정합니다.
          </p>
        </div>

        <div className="lg:col-span-8 space-y-7">
          {/* 위험 요인 */}
          <div>
            <p className="label-mono mb-3 flex items-baseline gap-2">
              <span className="text-signal-red font-mono">↑</span>
              위험을 끌어올리는 요인
            </p>
            {topRiskFactors.length === 0 ? (
              <p className="t-body-sm text-ink-soft">
                특별히 위험을 키우는 요인 없음.
              </p>
            ) : (
              <ul className="divide-y divide-ink-soft/30">
                {topRiskFactors.map((f) => (
                  <li key={f.factor} className="py-3 flex items-baseline gap-4">
                    <span className="font-display text-xl text-signal-red tabular-nums shrink-0 w-16">
                      +{f.log_lr.toFixed(2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-display text-lg text-ink leading-snug block">
                        {f.label}
                      </span>
                      <span className="text-sm text-ink-soft leading-relaxed">
                        {f.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 보호 요인 */}
          <div>
            <p className="label-mono mb-3 flex items-baseline gap-2">
              <span className="text-signal-green font-mono">↓</span>
              위험을 끌어내리는 요인
            </p>
            {topProtectiveFactors.length === 0 ? (
              <p className="t-body-sm text-ink-soft">
                위험을 낮추는 요인이 아직 없습니다. 응답 신선도·데이터 품질·
                응답자 수를 늘리면 이 자리에 보호 요인이 생깁니다.
              </p>
            ) : (
              <ul className="divide-y divide-ink-soft/30">
                {topProtectiveFactors.map((f) => (
                  <li key={f.factor} className="py-3 flex items-baseline gap-4">
                    <span className="font-display text-xl text-signal-green tabular-nums shrink-0 w-16">
                      {f.log_lr.toFixed(2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-display text-lg text-ink leading-snug block">
                        {f.label}
                      </span>
                      <span className="text-sm text-ink-soft leading-relaxed">
                        {f.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {fp6.triggered_caps.length > 0 ? (
            <div className="border-l-2 border-signal-red pl-4 py-1">
              <p className="kicker !text-signal-red mb-1">
                Critical Cap 발동
              </p>
              <p className="t-body-sm text-ink-soft leading-relaxed">
                {fp6.triggered_caps.length}개의 단일 임계값이 발동해 어려움
                가능성을 최소 {Math.round(fp6.cap_floor * 100)}% 까지 끌어올림
                — {fp6.triggered_caps.join(", ")}.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* 운영 신호 — 박스 대신 한 줄 통계 + 본문 단락 */}
      <div className="mt-16 dotted-rule" />
      <div className="mt-10">
        <p className="kicker mb-2">데이터·운영 상태</p>
        <h3 className="font-display text-2xl sm:text-3xl leading-tight tracking-tight mb-6">
          이 진단을{" "}
          <span className="italic font-light">얼마나 신뢰</span>할 수 있나.
        </h3>

        {/* 큰 통계 4개 — 박스 없이 가로 배열, 점선 구분 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-ink-soft/30 border-y border-ink-soft/30 py-5">
          <StatInline label="응답자" value={rows.length} suffix="명" />
          <StatInline
            label="진행 중 액션"
            value={activeActionCount}
          />
          <StatInline
            label="검증 완료"
            value={verifiedCount}
            tone={verifiedCount > 0 ? "green" : undefined}
          />
          <StatInline
            label="긴급 코치"
            value={highSeverity.length}
            tone={highSeverity.length > 0 ? "red" : undefined}
          />
        </div>

        {/* 3개 narrative 단락 — 박스 없이 좌측 가는 룰만으로 분리 */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6">
          <NarrativeCol
            title="응답 신뢰도"
            body={
              rows.length === 1
                ? `한 사람의 시각만 반영되어 합의도(σ)를 평가할 수 없습니다. 팀원 2–3명을 더 초대하면 σ 분산이 줄고 점수 신뢰도가 올라갑니다.`
                : rows.length < 4
                  ? `${rows.length}명 응답으로 합산되었으나 표본이 작습니다. 4명+ 부터 σ가 안정됩니다.`
                  : `${rows.length}명 응답으로 σ가 안정적입니다.`
            }
            footnote={
              fConsensus && fConsensus.log_lr > 0.1
                ? fConsensus.detail
                : undefined
            }
          />
          <NarrativeCol
            title="자기인식 vs 증거"
            body={
              delusionNarrative ??
              "아직 belief–evidence 격차를 평가할 데이터가 부족합니다."
            }
            footnote={
              fMissingEvidence && fMissingEvidence.log_lr > 0.1
                ? fMissingEvidence.detail
                : undefined
            }
          />
          <NarrativeCol
            title="데이터 신선도"
            body={
              fFreshness?.detail ??
              "응답 신선도 정보 없음."
            }
            highlight={
              fFreshness && fFreshness.log_lr > 0.3
                ? "90일이 지나면 점수 신뢰도가 떨어집니다. 분기 재진단을 권장합니다."
                : undefined
            }
            footnote={fDataQuality?.detail}
          />
        </div>

        {/* 운영 활동 narrative — 단순 단락 */}
        <p className="mt-8 text-base leading-relaxed text-ink-soft max-w-3xl">
          {verifiedCount === 0 && activeActionCount === 0
            ? "아직 액션 채택 이력이 없습니다. 빨강·노랑 도메인의 코치 페이지에서 SMART 액션을 채택하면 follow-up 과 점수 재계산까지 자동으로 흘러갑니다."
            : verifiedCount > 0
              ? `과거 ${verifiedCount}개 액션이 검증 완료되어 사실 기반의 개선 이력이 누적되고 있습니다. 이번 분기에는 진행 중인 ${activeActionCount}개의 마감을 챙기는 데 집중하세요.`
              : `${activeActionCount}개 액션이 진행 중이지만 아직 검증된 결과는 없습니다. 마감이 임박한 액션부터 챙기세요.`}
        </p>
      </div>

      {/* 다음 행동 CTA — 박스 없음. 위 점선 룰 + 인라인 링크 강조 */}
      <div className="mt-14 pt-6 border-t border-ink-soft/30">
        <p className="kicker mb-3">다음 행동</p>
        <div className="flex flex-wrap gap-3 items-center">
          {redDomains.length > 0 ? (
            <a
              href={`/diag/${workspace}/coach/${redDomains[0].code}`}
              className="btn-primary"
            >
              우선순위 1번 — {redDomains[0].code} {redDomains[0].name}
              <span className="font-mono text-xs">→</span>
            </a>
          ) : amberDomains.length > 0 ? (
            <a
              href={`/diag/${workspace}/coach/${amberDomains[0].code}`}
              className="btn-primary"
            >
              노랑 영역 점검 — {amberDomains[0].code} {amberDomains[0].name}
              <span className="font-mono text-xs">→</span>
            </a>
          ) : (
            <a href={`/diag/${workspace}/worklist`} className="btn-primary">
              워크리스트로 이동 <span className="font-mono text-xs">→</span>
            </a>
          )}
          <a
            href={`/diag/${workspace}/result`}
            className="label-mono hover:text-ink underline-offset-2 hover:underline"
          >
            상세 리포트 (요인 분해 전체) →
          </a>
          {rows.length < 4 ? (
            <a
              href={`/diag/${workspace}/members`}
              className="label-mono hover:text-ink underline-offset-2 hover:underline"
            >
              팀원 초대 (현재 {rows.length}명) →
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DomainTierColumn({
  tone,
  title,
  subtitle,
  count,
  items,
  workspace,
  empty,
}: {
  tone: "red" | "amber" | "green";
  title: string;
  subtitle: string;
  count: number;
  items: Array<{
    code: string;
    name: string;
    tier: string;
    score: number | null;
  }>;
  workspace: string;
  empty: string;
}) {
  const toneColor =
    tone === "red"
      ? "text-signal-red border-signal-red"
      : tone === "amber"
        ? "text-signal-amber border-signal-amber"
        : "text-signal-green border-signal-green";
  return (
    <div className={`pl-4 border-l-2 ${toneColor.split(" ")[1]}`}>
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <p className={`font-display text-xl font-medium ${toneColor.split(" ")[0]}`}>
          {title}
        </p>
        <p className="label-mono">{subtitle}</p>
        <p className="label-mono ml-auto">{count}개</p>
      </div>
      {items.length === 0 ? (
        <p className="t-body-sm text-ink-soft leading-relaxed">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 5).map((d) => (
            <li key={d.code} className="text-sm leading-snug">
              <a
                href={`/diag/${workspace}/coach/${d.code}`}
                className="hover:text-ink group flex items-baseline gap-2"
              >
                <span
                  className={`font-mono text-xs shrink-0 ${toneColor.split(" ")[0]}`}
                >
                  {d.code}
                </span>
                <span className="flex-1 min-w-0 truncate">{d.name}</span>
                <span className="label-mono tabular-nums shrink-0">
                  {Math.round(d.score ?? 0)}
                </span>
              </a>
            </li>
          ))}
          {items.length > 5 ? (
            <li className="label-mono pt-1">… 외 {items.length - 5}개</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function StatInline({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: "red" | "green";
}) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <p
        className={`font-display text-3xl sm:text-4xl leading-none tabular-nums ${
          tone === "red"
            ? "text-signal-red"
            : tone === "green"
              ? "text-signal-green"
              : "text-ink"
        }`}
      >
        {value}
        {suffix ? (
          <span className="text-lg text-ink-soft font-light">{suffix}</span>
        ) : null}
      </p>
      <p className="label-mono mt-2">{label}</p>
    </div>
  );
}

function NarrativeCol({
  title,
  body,
  highlight,
  footnote,
}: {
  title: string;
  body: string;
  highlight?: string;
  footnote?: string;
}) {
  return (
    <div>
      <p className="kicker mb-2">{title}</p>
      <p className="t-body-sm leading-relaxed">{body}</p>
      {highlight ? (
        <p className="t-body-sm text-signal-amber leading-relaxed mt-2">
          {highlight}
        </p>
      ) : null}
      {footnote ? (
        <p className="text-xs text-ink-soft mt-2 leading-relaxed">
          ※ {footnote}
        </p>
      ) : null}
    </div>
  );
}

import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  TASKS,
  TEAM_LABEL,
  TEAM_ORDER,
  TEAM_SUBTITLE,
  PHASE_LABEL,
  PHASE_ORDER,
  PHASE_DESC,
  CADENCE_LABEL,
  TIER_LABEL,
  FUNNEL_LABEL,
  FUNNEL_ORDER,
  getFunnelStage,
  getAiLeverage,
  type FunnelStage,
  type Phase,
  type Team,
  type Task,
} from "@/lib/worklist/catalog";
import {
  loadWorkspaceFacts,
  deriveAllStatuses,
  type AutoStatus,
} from "@/lib/worklist/derive";
import { loadFramework } from "@/lib/framework/loader";
import {
  DEFAULT_PRIORS,
  DEFAULT_LIKELIHOOD_RATIOS,
} from "@/lib/scoring";
import type { Stage } from "@/lib/scoring";
import type { DomainBaseline } from "@/lib/worklist/impact";
import { StatusPill } from "./_status-pill";
import { ProgressStrip } from "./_progress-strip";
import { FilterBar } from "./_filter-bar";
import { GoalsPanel } from "./_goals-panel";
import { FunnelRibbon } from "./_funnel-ribbon";
import { TaskTitle, TaskEditButton } from "./_task-customizer";
import { TaskDescriptionPopover } from "./_task-description";
import { ImpactPanel } from "./_impact-panel";
import { DataIngestPanel } from "./_data-ingest-panel";
import { DataDrivenExtras } from "./_data-driven-extras";
import { Emphasize } from "./_emphasize";
import { TaskKpiChecklist } from "./_task-kpi-checklist";
import { BulkPlaybookGenerator } from "./_bulk-playbook-generator";
import { sortByPriority } from "@/lib/worklist/priority";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ISSUE_DATE = new Date().toISOString().slice(0, 10);

export default async function WorklistPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();

  const sb = supabaseAdmin();
  const facts = await loadWorkspaceFacts(sb, workspace);
  const autoStatuses = deriveAllStatuses(TASKS, facts);
  const autoMap: Record<string, AutoStatus> = {};
  for (const [k, v] of autoStatuses) autoMap[k] = v;

  // ── Compute baselines for live impact panel ──────────────────────────
  // 진단 결과(diagnosis_responses.result)의 도메인 점수를 그대로 baseline으로 사용.
  // 응답이 여러 명이면 평균. 응답이 없으면 빈 배열 → ImpactPanel은 placeholder 표시.
  const framework = loadFramework();
  const { data: diagRows } = await sb
    .from("diagnosis_responses")
    .select("stage, result")
    .eq("workspace_id", workspace);
  const diagList = (diagRows ?? []) as Array<{
    stage: string | null;
    result: { domain_scores?: Array<{ code: string; score: number | null }> } | null;
  }>;

  const baselines: DomainBaseline[] = [];
  let stage: Stage = "open_beta";
  if (diagList.length > 0) {
    // average per-domain score across respondents
    const sums = new Map<string, { sum: number; n: number }>();
    for (const r of diagList) {
      for (const ds of r.result?.domain_scores ?? []) {
        if (ds.score === null || ds.score === undefined) continue;
        const cur = sums.get(ds.code) ?? { sum: 0, n: 0 };
        cur.sum += ds.score;
        cur.n += 1;
        sums.set(ds.code, cur);
      }
    }
    stage = ((diagList[diagList.length - 1].stage as Stage) ?? "open_beta") as Stage;
    for (const d of framework.domains) {
      const agg = sums.get(d.code);
      baselines.push({
        code: d.code,
        weight: d.weight,
        score: agg && agg.n > 0 ? agg.sum / agg.n : null,
        thresholds: d.thresholds,
        is_critical: d.tier === "critical",
        likelihood_ratio: DEFAULT_LIKELIHOOD_RATIOS[d.code],
      });
    }
  }
  const stagePriors = DEFAULT_PRIORS[stage] ?? DEFAULT_PRIORS.open_beta;

  // group by team -> phase -> tasks (sorted by priority within each phase)
  const grouped: Record<Team, Record<Phase, Task[]>> = {
    director: emptyPhaseMap(),
    planning: emptyPhaseMap(),
    design: emptyPhaseMap(),
    engineering: emptyPhaseMap(),
    operations: emptyPhaseMap(),
    marketing: emptyPhaseMap(),
  };
  for (const t of TASKS) grouped[t.team][t.phase].push(t);
  // 각 (team, phase) 블록 안에서 priorityScore 내림차순 정렬 — 1번 카드가 가장 중요.
  for (const team of TEAM_ORDER) {
    for (const phase of PHASE_ORDER) {
      grouped[team][phase] = sortByPriority(grouped[team][phase], stage);
    }
  }

  // funnel-stage counts (for ribbon)
  const funnelCounts: Record<FunnelStage, number> = {
    awareness: 0,
    acquisition: 0,
    activation: 0,
    retention: 0,
    revenue: 0,
    referral: 0,
    expansion: 0,
    internal: 0,
  };
  for (const t of TASKS) funnelCounts[getFunnelStage(t)] += 1;


  return (
    <main className="min-h-dvh w-full pb-20">
      {/* HERO */}
      <section className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-14">
          <div className="flex items-baseline gap-3 mb-3 flex-wrap">
            <span className="kicker">팀별 실행 체크리스트</span>
            <span className="label-mono">·</span>
            <span className="label-mono">{workspace}</span>
            <span className="label-mono">·</span>
            <span className="label-mono">
              {TASKS.length}개 업무 · 4단계 라이프사이클
            </span>
          </div>
          <h1 className="font-display text-4xl sm:text-6xl leading-[1.05] tracking-tight break-keep">
            누구도{" "}
            <span className="italic font-light">놓치지 않게,</span>
            <br />
            <span className="text-accent">팀별 워크리스트</span>
          </h1>
          <p className="mt-5 max-w-3xl text-base sm:text-lg leading-relaxed text-ink-soft">
            글로벌 SaaS·EdTech 운영 베스트 프랙티스를 기준으로,{" "}
            <strong className="font-medium text-ink">
              사전 준비 → 시장 진입 → 성장 → 운영 안정화
            </strong>
            의 4단계 라이프사이클에서 6개 팀이 수행해야 할 핵심 업무를 체계적으로
            정리했습니다. 진단 결과·코칭 데이터로 자동 채워지고, 상태 칩을 눌러
            수동으로 조정할 수 있습니다.
          </p>
          <ul className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs label-mono">
            {PHASE_ORDER.map((p) => (
              <li key={p} className="border border-ink-soft/40 px-3 py-2 bg-paper-soft">
                <p className="font-mono uppercase tracking-widest mb-1">
                  {p}
                </p>
                <p className="font-display text-base font-medium text-ink leading-tight">
                  {PHASE_LABEL[p]}
                </p>
                <p className="mt-1 leading-snug">{PHASE_DESC[p]}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* GOALS PANEL */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8">
        <GoalsPanel workspace={workspace} />
      </section>

      {/* DATA INGEST — 외부 분석 데이터로 워크리스트 변형 */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-5">
        <DataIngestPanel workspace={workspace} />
      </section>

      {/* FUNNEL RIBBON — Customer Journey */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-5">
        <FunnelRibbon workspace={workspace} counts={funnelCounts} />
      </section>

      {/* LIVE IMPACT — 워크리스트 완료 → 실패확률 변화 */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-5">
        <ImpactPanel
          workspace={workspace}
          baselines={baselines}
          prior_fp_6m={stagePriors.failure_6m}
          prior_fp_12m={stagePriors.failure_12m}
          hasDiagnosis={baselines.length > 0}
        />
      </section>

      {/* PROGRESS + FILTER */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <ProgressStrip
            workspace={workspace}
            tasks={TASKS}
            autoMap={autoMap}
          />
        </div>
        <FilterBar workspace={workspace} tasks={TASKS} autoMap={autoMap} />
      </section>

      {/* TEAM SECTIONS */}
      <section
        id="team-sections"
        className="max-w-6xl mx-auto px-6 sm:px-10 mt-12 space-y-12 scroll-mt-20"
      >
        {TEAM_ORDER.map((team, ti) => {
          const phaseMap = grouped[team];
          const totalForTeam = PHASE_ORDER.reduce(
            (n, p) => n + phaseMap[p].length,
            0,
          );
          if (totalForTeam === 0) return null;

          return (
            <section
              key={team}
              data-team-section={team}
              className="border-t-2 border-ink pt-6 scroll-mt-28"
            >
              <header className="flex items-baseline justify-between gap-4 flex-wrap mb-6">
                <div>
                  <p className="kicker mb-1">
                    <span className="section-num">No. </span>
                    {(ti + 1).toString().padStart(2, "0")}
                  </p>
                  <h2 className="font-display text-3xl sm:text-4xl leading-tight tracking-tight">
                    {TEAM_LABEL[team]}
                  </h2>
                  <p className="mt-1 label-mono">{TEAM_SUBTITLE[team]}</p>
                </div>
                <p className="label-mono">{totalForTeam}개 업무</p>
              </header>

              <div className="space-y-8">
                {PHASE_ORDER.map((phase) => {
                  const tasks = phaseMap[phase];
                  if (tasks.length === 0) return null;
                  return (
                    <div
                      key={phase}
                      data-phase-block={phase}
                      data-team={team}
                    >
                      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3 pb-2 border-b border-ink-soft/30">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
                            {phase}
                          </span>
                          <h3 className="font-display text-lg font-medium leading-tight">
                            {PHASE_LABEL[phase]}
                          </h3>
                          <span className="label-mono">
                            · {PHASE_DESC[phase]}
                          </span>
                        </div>
                        <span className="label-mono">{tasks.length}개</span>
                      </div>

                      <ol className="space-y-3">
                        {tasks.map((t, i) => {
                          const auto = autoStatuses.get(t.id) ?? "unknown";
                          const stage = getFunnelStage(t);
                          const ai = getAiLeverage(t);
                          return (
                            <li
                              key={t.id}
                              data-task-id={t.id}
                              data-team={t.team}
                              data-phase={t.phase}
                              data-funnel={stage}
                              data-tier={t.tier}
                              className="relative border border-ink-soft/40 hover:border-ink/60 bg-paper transition-colors"
                            >
                              <div className="flex items-start gap-3 sm:gap-4 p-4 sm:p-5">
                                <span
                                  className="font-mono text-[11px] font-semibold text-accent mt-1 w-9 shrink-0 tabular-nums tracking-wide"
                                  title={`팀-단계 내 우선순위 P${(i + 1).toString().padStart(2, "0")}`}
                                >
                                  P{(i + 1).toString().padStart(2, "0")}
                                </span>
                                <div className="flex-1 min-w-0">
                                  {/* Tags row + action toolbar (?, ✎, Status) on the right */}
                                  <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="flex items-baseline gap-2 flex-wrap min-w-0 pt-0.5">
                                      <span
                                        className={`tag ${
                                          t.tier === "must"
                                            ? "tag-accent"
                                            : t.tier === "conditional"
                                              ? "tag-gold"
                                              : "tag"
                                        }`}
                                      >
                                        {TIER_LABEL[t.tier]}
                                      </span>
                                      <span className="label-mono">
                                        {CADENCE_LABEL[t.cadence]}
                                      </span>
                                      <span
                                        className={`label-mono px-1.5 ${
                                          stage === "internal"
                                            ? "bg-paper-deep text-ink-soft border border-ink-soft/30"
                                            : "bg-soft-cobalt/40 text-cobalt border border-cobalt/40"
                                        }`}
                                        title={`고객여정 단계: ${FUNNEL_LABEL[stage]}`}
                                      >
                                        {FUNNEL_LABEL[stage]}
                                      </span>
                                      {ai ? (
                                        <span
                                          className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 bg-green text-paper"
                                          title={`AI 활용: ${ai}`}
                                        >
                                          AI
                                        </span>
                                      ) : null}
                                      {t.domain ? (
                                        <span className="label-mono">
                                          · {t.domain}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="shrink-0 flex items-center gap-1.5">
                                      <TaskDescriptionPopover
                                        description={t.description}
                                        why={t.why}
                                        hint={t.hint}
                                        ai_leverage={ai}
                                        escalation_hint={t.escalation_hint}
                                        cadence={t.cadence}
                                        tier={t.tier}
                                        domain={t.domain}
                                        task={t}
                                      />
                                      <TaskEditButton
                                        workspace={workspace}
                                        task={t}
                                      />
                                      <StatusPill
                                        workspace={workspace}
                                        taskId={t.id}
                                        autoStatus={auto}
                                      />
                                    </div>
                                  </div>
                                  <TaskTitle workspace={workspace} task={t} />
                                  <p className="mt-3 t-body">
                                    <span className="inline-block mr-2 px-1.5 py-0.5 t-label-ink !text-paper bg-ink align-middle">
                                      왜
                                    </span>
                                    <Emphasize text={t.why} />
                                  </p>
                                  {ai ? (
                                    <p className="mt-2 t-body">
                                      <span className="inline-block mr-2 px-1.5 py-0.5 t-label-ink !text-paper bg-green align-middle">
                                        AI 활용
                                      </span>
                                      <Emphasize text={ai} />
                                    </p>
                                  ) : null}
                                  {t.hint ? (
                                    <p className="mt-2 t-body">
                                      <span className="inline-block mr-2 px-1.5 py-0.5 t-label-ink !text-paper bg-cobalt align-middle">
                                        힌트
                                      </span>
                                      <Emphasize text={t.hint} />
                                    </p>
                                  ) : null}
                                  {t.escalation_hint ? (
                                    <p className="mt-3 inline-flex items-baseline gap-2 t-body-sm px-3 py-2 bg-soft-amber/50 border-l-4 border-amber/80">
                                      <span className="t-label-ink text-amber shrink-0">
                                        목표 가속
                                      </span>
                                      <Emphasize text={t.escalation_hint} />
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                              <TaskKpiChecklist task={t} workspace={workspace} />
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </section>

      {/* DATA-DRIVEN EXTRAS — derived 신규 업무 + override 배지 데코레이션 */}
      <DataDrivenExtras workspace={workspace} />

      {/* BULK PLAYBOOK GENERATOR — 진단 완료 후 모든 카드 실무 자료 자동 생성 */}
      <BulkPlaybookGenerator
        workspace={workspace}
        hasDiagnosis={baselines.length > 0}
      />

      {/* FOOTER */}
      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">
          {workspace} · 자동값과 수동 override를 함께 사용 — 자동값은 데이터로,
          수동값은 팀 판단으로.
        </p>
        <p className="label-mono">{ISSUE_DATE}</p>
      </footer>
    </main>
  );
}

function emptyPhaseMap(): Record<Phase, Task[]> {
  return {
    foundation: [],
    launch: [],
    growth: [],
    ops: [],
  };
}

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
import type { Stage, DomainDef, SubItemDef } from "@/lib/scoring";
import {
  aggregateRespondents,
  type DiagRowMin,
} from "@/lib/diagnosis-aggregate";
import type {
  DiagnosisBaseline,
  SerializedSubItemResponse,
} from "@/lib/worklist/impact";
import { StatusPill } from "./_status-pill";
import { ProgressStrip } from "./_progress-strip";
import { SearchFilterBar } from "./_search-filter-bar";
// GoalsPanel·DataIngestPanel 은 진단 시작 단계로 이동 → 워크리스트 페이지에서 제거.
import { FunnelRibbon } from "./_funnel-ribbon";
import { TaskTitle, TaskEditButton } from "./_task-customizer";
import { TaskDescriptionPopover } from "./_task-description";
import { ImpactPanel } from "./_impact-panel";
import { DataDrivenExtras } from "./_data-driven-extras";
import { Emphasize } from "./_emphasize";
import { TaskKpiChecklist } from "./_task-kpi-checklist";
import { BulkPlaybookGenerator } from "./_bulk-playbook-generator";
import { ScrollToTopButton } from "./_scroll-to-top";
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

  // ── Compute baseline for live impact panel ──────────────────────────
  // 홈/결과 페이지와 동일한 점수가 나오도록 aggregateRespondents 로 재집계.
  // (이전엔 stored snapshot 평균 + 단일-LR Bayesian 을 썼고, 홈은 raw 응답 +
  //  8-factor log-LR 모델을 써서 두 페이지 숫자가 달랐음.)
  const framework = loadFramework();
  const { data: diagRows } = await sb
    .from("diagnosis_responses")
    .select("stage, respondent_num, responses")
    .eq("workspace_id", workspace);
  const diagListRaw = (diagRows ?? []) as Array<{
    stage: string | null;
    respondent_num: number;
    responses: DiagRowMin["responses"];
  }>;

  let baseline: DiagnosisBaseline | null = null;
  if (diagListRaw.length > 0) {
    // 동일 helper 로 도메인 점수·stage 산출
    const agg = aggregateRespondents(framework, diagListRaw);

    // sub-item defs + domain defs (computeFailureProbability 입력)
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
    const domainDefs: DomainDef[] = framework.domains.map((d) => ({
      code: d.code,
      weight: d.weight,
      tier: d.tier,
    }));

    // 직렬화된 응답 모음 (Date → ISO string)
    const serialized: SerializedSubItemResponse[] = [];
    for (const row of diagListRaw) {
      if (!row.responses) continue;
      for (const [code, r] of Object.entries(row.responses)) {
        if (!subDefMap.has(code)) continue;
        if (!r.belief) continue;
        serialized.push({
          sub_item_code: code,
          respondent_id: `r${row.respondent_num}`,
          belief: r.belief,
          evidence:
            r.na || r.evidence === null || r.evidence === undefined
              ? null
              : r.evidence,
          evidence_recorded_at: r.evidence_recorded_at,
        });
      }
    }

    baseline = {
      domainScores: agg.domain_scores,
      domainDefs,
      subDefs,
      responses: serialized,
      stage: agg.stage,
      respondentCount: diagListRaw.length,
      // YAML SoT — client 측 computeImpact 가 buildScoringConfig 로 컴파일
      scoringSource: {
        priors: framework.priors,
        likelihood_ratios: framework.likelihood_ratios,
        critical_caps: framework.critical_caps,
      },
    };
  }
  const stage: Stage = baseline?.stage ?? "open_beta";

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
      {/* COMPACT HEADER — 진단 카드 hub로 돌아가는 link + 카드 ID + 한 줄 설명 */}
      <section className="border-b border-ink-soft">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-5 sm:py-6 flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3 flex-wrap min-w-0">
            <a href="/worklist" className="label-mono hover:text-ink shrink-0">
              ← 진단 카드 목록
            </a>
            <span className="label-mono opacity-40">·</span>
            <span className="font-mono text-sm font-medium text-ink break-all">
              {workspace}
            </span>
            <span className="label-mono opacity-40">·</span>
            <span className="label-mono">{TASKS.length}개 업무 · 6팀 · 4단계</span>
          </div>
          <a
            href={`/diag/${workspace}/home`}
            className="label-mono hover:text-ink"
          >
            카드 홈 →
          </a>
        </div>
      </section>

      {/* HERO — 실시간 실패확률 변화. 페이지 헤더 + 히어로 결합 */}
      <ImpactPanel
        workspace={workspace}
        baseline={baseline}
        workspaceMeta={{
          totalTasks: TASKS.length,
          teamsLabel: "6팀 · 4단계",
        }}
      />

      {/* PROGRESS STRIP — slim, 단독 */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8">
        <ProgressStrip workspace={workspace} tasks={TASKS} autoMap={autoMap} />
      </section>

      {/* FUNNEL RIBBON — 고객여정 단계별 분포. 항상 노출 (예전엔 collapsible) */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        <FunnelRibbon workspace={workspace} counts={funnelCounts} />
      </section>

      {/* TEAM SECTIONS HEADER + SEARCH·FILTER — 업무 리스트 바로 위에 배치 */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12 mb-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="kicker mb-1">
              <span className="section-num">No. </span>02
            </p>
            <h2 className="font-display text-2xl sm:text-3xl leading-tight tracking-tight">
              팀별 업무 리스트
            </h2>
          </div>
          <p className="label-mono">
            P01 = 팀-단계 내 우선순위 1번 · 위에서 아래로 중요도 순
          </p>
        </div>
        <SearchFilterBar
          workspace={workspace}
          tasks={TASKS}
          autoMap={autoMap}
        />
      </div>
      <section
        id="team-sections"
        className="max-w-6xl mx-auto px-6 sm:px-10 space-y-12 scroll-mt-20"
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
        hasDiagnosis={baseline !== null}
      />

      {/* FOOTER */}
      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">
          {workspace} · 자동값과 수동 override를 함께 사용 — 자동값은 데이터로,
          수동값은 팀 판단으로.
        </p>
        <p className="label-mono">{ISSUE_DATE}</p>
      </footer>

      {/* FLOATING — 맨 위로 스크롤 버튼 */}
      <ScrollToTopButton />
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

import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFramework, type Domain } from "@/lib/framework/loader";
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
import { WorklistImpactBanner } from "./_worklist-impact-banner";

interface Props {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ session?: string; respondent?: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ISSUE_DATE = new Date().toISOString().slice(0, 10);

interface DiagnosisRow {
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

export default async function ResultPage({ params, searchParams }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();
  const sp = await searchParams;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("diagnosis_responses")
    .select(
      "id, workspace_id, respondent_num, role, perspective, stage, responses, result, completed_at",
    )
    .eq("workspace_id", workspace)
    .order("respondent_num", { ascending: true });

  if (error) {
    return (
      <ErrorView workspace={workspace} message={error.message} />
    );
  }

  const rows = (data ?? []) as DiagnosisRow[];
  if (rows.length === 0) {
    return <EmptyView workspace={workspace} />;
  }

  const framework = loadFramework();
  const aggregate = aggregateRespondents(framework, rows);

  // Quarterly diagnosis check — surface a banner if the latest response is > 90d old
  const latestRow = rows[rows.length - 1];
  const latestDate = new Date(latestRow.completed_at);
  const daysSinceLatest = Math.floor(
    (Date.now() - latestDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  const quarterlyDue = daysSinceLatest >= 90;

  return (
    <main className="min-h-dvh w-full pb-20">
      {/* MASTHEAD */}
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <a
              href={`/diag/${workspace}/home`}
              className="kicker hover:text-ink"
            >
              ← 홈
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              workspace · {workspace}
            </span>
          </div>
          <span className="label-mono">RESULT / SUMMARY</span>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-4">진단 상세 리포트</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Reality{" "}
          <span className="text-accent italic font-display">Report</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          {rows.length}명의 응답으로 12개 도메인 점수와 6/12개월 실패확률을 산출한
          상세 리포트입니다. <strong>다요인 분해</strong>·도메인 breakdown·응답자 합의도·
          워크리스트 임팩트가 모두 한 곳에. 매일 보는 화면은{" "}
          <a
            href={`/diag/${workspace}/home`}
            className="underline hover:text-ink"
          >
            홈
          </a>{" "}
          입니다.
        </p>
        {sp.respondent ? (
          <p className="mt-3 label-mono">
            방금 제출한 응답은 #{sp.respondent}번입니다.{" "}
            <a
              href={`/diag/${workspace}/home`}
              className="underline hover:text-ink"
            >
              → 홈에서 이번 주 할 일 보기
            </a>
          </p>
        ) : null}
      </section>

      {/* QUARTERLY DUE BANNER */}
      {quarterlyDue ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
          <div className="area-card !border-signal-amber bg-soft-amber/40">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="kicker mb-1 !text-signal-amber">
                  Quarterly review · {daysSinceLatest}d 경과
                </p>
                <h2 className="font-display text-2xl">
                  분기 진단 시점 — 재응답을 권장합니다
                </h2>
                <p className="mt-2 text-sm text-ink-soft">
                  마지막 응답일 {latestDate.toISOString().slice(0, 10)}.
                  90일 이상 경과하면 KPI/팀/시장 변동이 점수에 반영되지 않아
                  코치 정확도가 떨어집니다.
                </p>
              </div>
              <a href={`/diag/${workspace}`} className="btn-primary">
                재진단 시작
                <span className="font-mono text-xs">→</span>
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {/* HEADLINE — 한눈에 보기 (직원도 이해 가능한 평이한 표현) */}
      <SummaryPanel
        overall={aggregate.overall}
        fp6m={aggregate.fp["6m"].final}
        fp12m={aggregate.fp["12m"].final}
        prior6m={aggregate.fp["6m"].prior}
        prior12m={aggregate.fp["12m"].prior}
        respondents={rows.length}
        stage={aggregate.stage}
        contributions={aggregate.fp["6m"].domain_contributions ?? []}
        factorContributions={aggregate.fp["6m"].factor_contributions ?? []}
        domainNameMap={Object.fromEntries(
          framework.domains.map((d) => [d.code, d.name_ko]),
        )}
      />

      {/* WORKLIST IMPACT — 워크리스트 진행이 점수에 반영된 결과 (실시간) */}
      <WorklistImpactBanner
        workspace={workspace}
        baseline={aggregate.domain_scores.map((d) => ({
          code: d.domain,
          score: d.score,
        }))}
        baselineOverall={aggregate.overall}
      />

      {/* RED CRITICAL DOMAINS BANNER */}
      {aggregate.fp["6m"].red_critical_domains.length > 0 ||
      aggregate.fp["6m"].triggered_caps.length > 0 ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8">
          <div className="area-card !border-signal-red bg-soft-red/40">
            <p className="kicker mb-2 !text-signal-red">! Red flags</p>
            <h2 className="font-display text-2xl">
              빨간 critical 도메인 ·{" "}
              {aggregate.fp["6m"].red_critical_domains.length}개
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {aggregate.fp["6m"].red_critical_domains.map((code) => {
                const d = framework.domains.find((x) => x.code === code);
                return (
                  <li
                    key={code}
                    className="tag tag-red"
                  >{`${code} · ${d?.name_ko ?? ""}`}</li>
                );
              })}
            </ul>
            {aggregate.fp["6m"].triggered_caps.length > 0 ? (
              <p className="mt-3 label-mono">
                triggered caps: {aggregate.fp["6m"].triggered_caps.join(", ")}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Domain breakdown
          </span>
        </div>
      </div>

      {/* 모든 도메인이 같은 점수 (보통 belief=3·evidence=3 으로 균일 응답)인 경우 안내 */}
      {(() => {
        const scores = aggregate.domain_scores
          .map((d) => d.score)
          .filter((s): s is number => s !== null && s !== undefined);
        if (scores.length < 3) return null;
        const allEqual = scores.every((s) => Math.abs(s - scores[0]) < 0.5);
        if (!allEqual) return null;
        return (
          <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
            <div className="border-l-4 border-amber bg-soft-amber/30 px-4 py-3">
              <p className="t-label-ink text-amber mb-1">진단 데이터 안내</p>
              <p className="t-body-sm">
                모든 도메인 점수가 동일 ({scores[0].toFixed(0)}점)합니다. 진단
                응답이 모든 sub-item에 대해 belief={"{중간}"}·evidence={"{중간}"} 으로
                균일하게 저장된 상태일 가능성이 큽니다. 더 정확한 진단 결과를
                받으려면 워크스페이스 진단 폼에서 각 항목을 본인의 실제 상황에
                맞게 1–5 다양한 값으로 다시 응답해주세요.
              </p>
            </div>
          </section>
        );
      })()}

      {/* DOMAIN BARS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 space-y-3">
        {framework.domains.map((d) => {
          const ds = aggregate.domain_scores.find((x) => x.domain === d.code);
          return (
            <DomainBar
              key={d.code}
              domain={d}
              result={ds}
              workspace={workspace}
            />
          );
        })}
      </section>

      {/* RESPONDENTS LIST */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament mb-6">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Respondents · {rows.length}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map((r) => (
            <article key={r.id} className="metric-card">
              <p className="kicker">
                <span className="section-num">No. </span>
                {r.respondent_num}
              </p>
              <p className="font-display text-xl mt-1 leading-tight">
                {r.role || "익명 응답자"}
              </p>
              <p className="label-mono">
                {r.perspective ?? "-"} · {r.stage ?? "-"} ·{" "}
                {Object.keys(r.responses ?? {}).length}개 응답
              </p>
              <p className="label-mono mt-1">
                {formatTime(r.completed_at)}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* NEXT STEP */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-14">
        <div className="area-card">
          <p className="kicker mb-2">Phase 2 · AI Coaching MVP</p>
          <h2 className="font-display text-3xl">다음 단계 — AI 도메인 코치</h2>
          <p className="mt-3 text-ink-soft leading-relaxed">
            결손 도메인이 감지되면 해당 도메인 AI 코치(예: PMF Coach, CFO/IR
            Agent)가 활성화되어 진단 질문 → 증거 요청 → SMART 3단계 액션을
            제안합니다. 다음 작업에서 PMF·Unit Eco·Team 3개 도메인부터 코칭
            루프를 wiring합니다.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/diag/${workspace}/actions`}
              className="btn-primary"
            >
              Action board
              <span className="font-mono text-xs">→</span>
            </a>
            <a
              href={`/diag/${workspace}/timeline`}
              className="btn-secondary"
            >
              Timeline
              <span className="font-mono text-xs">→</span>
            </a>
            <a
              href={`/diag/${workspace}/signals`}
              className="btn-secondary"
            >
              KPI Signal feed
              <span className="font-mono text-xs">→</span>
            </a>
            <a href={`/diag/${workspace}`} className="btn-secondary">
              <span className="font-mono text-xs">←</span>
              다시 응답하기
            </a>
            <a href="/diag" className="btn-secondary">
              <span className="font-mono text-xs">←</span>
              Domain Map
            </a>
          </div>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">
          aggregated across {rows.length} respondents
        </p>
        <p className="label-mono">{ISSUE_DATE} · result v1</p>
      </footer>
    </main>
  );
}

// ============================================================
// Aggregation
// ============================================================

interface AggregateResult {
  overall: number | null;
  domain_scores: DomainScoreResult[];
  fp: ReturnType<typeof computeFailureProbability>;
  stage: Stage;
}

function aggregateRespondents(
  framework: ReturnType<typeof loadFramework>,
  rows: DiagnosisRow[],
): AggregateResult {
  // 모든 응답자의 sub-item 응답을 합쳐 SubItemResponse[]로 변환
  const subDefs: SubItemDef[] = framework.domains.flatMap((d) =>
    d.groups.flatMap((g) =>
      g.sub_items.map((s) => ({
        code: s.code,
        domain: s.domain,
        group: s.group,
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

  // Per-sub-item average (consensus aware)
  const subScoreAvg = new Map<
    string,
    ReturnType<typeof computeSubItemScore>
  >();
  for (const def of subDefs) {
    const scores: number[] = [];
    let representativeFlag: ReturnType<
      typeof computeSubItemScore
    >["flag"];
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

  // Group + Domain
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

  const domainScores = framework.domains.map((d) => {
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

  const overall = computeOverallScore(
    domainScores,
    framework.domains.map((d) => ({
      code: d.code,
      weight: d.weight,
      tier: d.tier,
    })),
  );

  // Stage: 가장 흔한 stage (혹은 최신 응답자)
  const stage = (rows[rows.length - 1]?.stage as Stage) ?? "open_beta";

  const fp = computeFailureProbability(
    domainScores,
    framework.domains.map((d) => ({
      code: d.code,
      weight: d.weight,
      tier: d.tier,
    })),
    responses,
    stage,
    undefined,
    {
      subDefs,
      now,
      respondentCount: rows.length,
    },
  );

  return { overall, domain_scores: domainScores, fp, stage };
}

// ============================================================
// Sub-components
// ============================================================

function SummaryPanel({
  overall,
  fp6m,
  fp12m,
  prior6m,
  prior12m,
  respondents,
  stage,
  contributions,
  factorContributions,
  domainNameMap,
}: {
  overall: number | null;
  fp6m: number;
  fp12m: number;
  prior6m: number;
  prior12m: number;
  respondents: number;
  stage: string;
  contributions: Array<{
    domain: string;
    score: number;
    band: "red" | "amber" | "neutral" | "green" | "excellent";
    multiplier: number;
  }>;
  factorContributions: Array<{
    factor: string;
    label: string;
    log_lr: number;
    detail: string;
  }>;
  domainNameMap: Record<string, string>;
}) {
  const overallNum = overall ?? 0;
  const overallTone =
    overall === null
      ? "neutral"
      : overall >= 70
        ? "green"
        : overall >= 40
          ? "amber"
          : "red";
  const overallLabel =
    overallTone === "green"
      ? "양호"
      : overallTone === "amber"
        ? "주의"
        : overallTone === "red"
          ? "위험"
          : "평가 보류";
  const overallSentence =
    overall === null
      ? "응답이 부족해 점수를 산출하지 못했습니다."
      : overall >= 70
        ? "지금 흐름을 이어가도 좋습니다. 정기 점검은 계속 유지하세요."
        : overall >= 40
          ? "한두 영역이 흔들리고 있습니다. 빨간 영역부터 우선 점검."
          : "여러 영역이 빨강입니다. 이번 주 안에 책임자 지정 + 액션 채택이 필요합니다.";

  const tone6m =
    fp6m < 0.25 ? "green" : fp6m < 0.45 ? "amber" : "red";
  const tone12m =
    fp12m < 0.35 ? "green" : fp12m < 0.55 ? "amber" : "red";

  const reliabilitySentence =
    respondents === 1
      ? "한 사람의 시각만 반영됨 — 팀원이 추가로 응답하면 결과 신뢰도가 크게 올라갑니다."
      : respondents < 4
        ? `응답자 ${respondents}명 — 표본이 적어 신뢰구간이 넓습니다. 4명 이상이면 ‘이견 큼’ 라벨도 활성화됩니다.`
        : respondents < 7
          ? `응답자 ${respondents}명 — 적정 수준. 7명 이상이면 통계적 신뢰도가 더욱 안정됩니다.`
          : `응답자 ${respondents}명 — 충분한 표본으로 결과가 안정적입니다.`;

  const stageLabel =
    ({
      closed_beta: "비공개 베타",
      open_beta: "공개 베타",
      ga_early: "정식 출시 (0–6개월)",
      ga_growth: "성장기 (6–24개월)",
      ga_scale: "확장기 (24개월+)",
    } as Record<string, string>)[stage] ?? stage;

  return (
    <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
      <div
        className={`border-2 p-6 sm:p-8 ${
          overallTone === "red"
            ? "border-signal-red bg-soft-red/40"
            : overallTone === "amber"
              ? "border-signal-amber bg-soft-amber/40"
              : overallTone === "green"
                ? "border-signal-green bg-soft-green/40"
                : "border-ink bg-paper-soft"
        }`}
      >
        {/* ── Status badge + verdict sentence ── */}
        <div className="flex items-baseline gap-3 mb-3 flex-wrap">
          <span
            className={`tag ${
              overallTone === "red"
                ? "tag-red"
                : overallTone === "amber"
                  ? "tag-gold"
                  : overallTone === "green"
                    ? "tag-green"
                    : "tag-filled"
            }`}
          >
            {overallTone === "red"
              ? "● 위험"
              : overallTone === "amber"
                ? "● 주의"
                : overallTone === "green"
                  ? "● 양호"
                  : overallLabel}
          </span>
          <p className="kicker">우리 회사 한눈에 보기</p>
        </div>

        <h2 className="font-display text-3xl sm:text-5xl leading-[1.05] tracking-tight break-keep">
          종합 건강도{" "}
          <span
            className={
              overallTone === "red"
                ? "text-signal-red"
                : overallTone === "amber"
                  ? "text-signal-amber"
                  : overallTone === "green"
                    ? "text-signal-green"
                    : "text-ink"
            }
          >
            {overall === null ? "—" : Math.round(overallNum)}
          </span>
          <span className="text-ink-soft text-2xl sm:text-3xl">{" "}/ 100점</span>
        </h2>
        <p className="mt-2 text-base sm:text-lg leading-relaxed text-ink-soft max-w-3xl">
          → {overallLabel} 단계. {overallSentence}
        </p>

        {/* ── Risk explanation in plain words ── */}
        <div className="mt-6 pt-5 border-t border-ink-soft/30 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <RiskCard
            title="6개월 안에 어려움을 겪을 가능성"
            now={fp6m}
            base={prior6m}
            tone={tone6m}
            stageLabel={stageLabel}
          />
          <RiskCard
            title="12개월 안에 어려움을 겪을 가능성"
            now={fp12m}
            base={prior12m}
            tone={tone12m}
            stageLabel={stageLabel}
          />
        </div>
        <p className="mt-2 label-mono leading-relaxed">
          ⓘ 비교 기준 — {stageLabel} 단계 회사 N=431 (CB Insights)의 6/12개월
          실패율 평균. 우리 진단 결과를 합쳐 베이지안으로 보정한 값입니다.
        </p>

        {/* ── Why this number — 다요인 log-LR 분해 (multi-factor model) ── */}
        {factorContributions.length > 0 ? (
          <div className="mt-5 pt-4 border-t border-ink-soft/30">
            <p className="kicker mb-2">왜 이 숫자가 나왔나 — 8개 요인 분해</p>
            <p className="text-sm text-ink-soft leading-relaxed mb-3">
              평균 위험도(prior {(prior6m * 100).toFixed(0)}%)에서 우리 데이터의 8개 신호가
              각각 위험을 얼마나 올렸/내렸는지 보여줍니다. 양수 = 위험 상승, 음수 = 위험 하락.
              모두 합산해 최종 배수가 산출됩니다.
            </p>
            <ul className="space-y-2">
              {factorContributions
                .slice()
                .sort((a, b) => b.log_lr - a.log_lr)
                .map((f) => {
                  const pct = (Math.exp(f.log_lr) - 1) * 100;
                  const tone =
                    f.log_lr > 0.2
                      ? "text-signal-red"
                      : f.log_lr > 0.05
                        ? "text-signal-amber"
                        : f.log_lr < -0.05
                          ? "text-signal-green"
                          : "text-ink-soft";
                  const arrow =
                    f.log_lr > 0.05 ? "↑" : f.log_lr < -0.05 ? "↓" : "→";
                  return (
                    <li
                      key={f.factor}
                      className="flex items-start justify-between gap-3 border border-ink-soft/30 bg-paper p-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{f.label}</p>
                        <p className="label-mono mt-0.5 leading-relaxed">
                          {f.detail}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-mono text-base ${tone}`}>
                          {arrow}{" "}
                          {pct > 0
                            ? `+${pct.toFixed(0)}%`
                            : `${pct.toFixed(0)}%`}
                        </p>
                        <p className="label-mono">위험 {f.log_lr > 0 ? "상승" : f.log_lr < 0 ? "하락" : "동일"}</p>
                      </div>
                    </li>
                  );
                })}
            </ul>

            {/* Critical 도메인 가중치 (보조) */}
            {contributions.length > 0 ? (
              <details className="mt-3 pt-3 border-t border-ink-soft/20">
                <summary className="cursor-pointer label-mono inline-flex items-center gap-1.5">
                  <span className="font-mono">▶</span>
                  Critical 도메인 가중치 기여도
                </summary>
                <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {contributions
                    .slice()
                    .sort((a, b) => b.multiplier - a.multiplier)
                    .map((c) => {
                      const tone =
                        c.band === "red"
                          ? "text-signal-red"
                          : c.band === "amber"
                            ? "text-signal-amber"
                            : c.band === "excellent" || c.band === "green"
                              ? "text-signal-green"
                              : "text-ink-soft";
                      const bandLabel = {
                        red: "위험 (< 40)",
                        amber: "주의 (40–60)",
                        neutral: "중립 (60–75)",
                        green: "양호 (75–85)",
                        excellent: "우수 (85+)",
                      }[c.band];
                      return (
                        <li
                          key={c.domain}
                          className="flex items-baseline justify-between gap-2 border border-ink-soft/30 bg-paper p-2"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">
                              {c.domain} · {domainNameMap[c.domain] ?? ""}
                            </p>
                            <p className={`label-mono ${tone}`}>
                              점수 {c.score.toFixed(0)} · {bandLabel}
                            </p>
                          </div>
                          <p className="font-mono text-sm shrink-0">
                            {(c.multiplier * 100).toFixed(0)}%
                          </p>
                        </li>
                      );
                    })}
                </ul>
              </details>
            ) : null}

            <p className="mt-3 label-mono leading-relaxed">
              ⓘ 알고리즘 (multi-factor log-LR) — 8개 요인의 log-LR 합산 → exp() → 단일 배수.
              요인: ① critical 도메인 가중 평균 ② important 도메인 평균 ③ 실측 evidence 비율
              ④ 평균 응답 경과일 ⑤ 응답자 수 ⑥ belief-evidence 격차 ⑦ critical evidence 결측률
              ⑧ 응답자 합의도(σ). 폭주 방지 cap = log(15).
            </p>
          </div>
        ) : null}

        {/* ── Reliability ── */}
        <div className="mt-5 pt-4 border-t border-ink-soft/30">
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="kicker">결과 신뢰도</p>
            <p className="text-sm">
              <strong className="font-medium">응답자 {respondents}명</strong> ·
              회사 단계 <strong className="font-medium">{stageLabel}</strong>
            </p>
          </div>
          <p className="mt-1 text-sm text-ink-soft leading-relaxed">
            {reliabilitySentence}
          </p>
        </div>

        {/* ── Tech detail (collapsed) ── */}
        <details className="mt-4 pt-3 border-t border-ink-soft/20">
          <summary className="cursor-pointer label-mono inline-flex items-center gap-1.5">
            <span className="font-mono">▶</span>
            기술 세부 (Bayesian · prior · capped)
          </summary>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
            <div className="border border-ink-soft/30 p-2 bg-paper">
              <p className="label-mono">Overall</p>
              <p className="font-display text-lg leading-none mt-1">
                {overall === null ? "—" : overall.toFixed(1)}
              </p>
              <p className="label-mono mt-1">0–100, weighted</p>
            </div>
            <div className="border border-ink-soft/30 p-2 bg-paper">
              <p className="label-mono">P(fail, 6m)</p>
              <p className="font-display text-lg leading-none mt-1">
                {(fp6m * 100).toFixed(1)}%
              </p>
              <p className="label-mono mt-1">
                prior {(prior6m * 100).toFixed(0)}%
              </p>
            </div>
            <div className="border border-ink-soft/30 p-2 bg-paper">
              <p className="label-mono">P(fail, 12m)</p>
              <p className="font-display text-lg leading-none mt-1">
                {(fp12m * 100).toFixed(1)}%
              </p>
              <p className="label-mono mt-1">
                prior {(prior12m * 100).toFixed(0)}%
              </p>
            </div>
            <div className="border border-ink-soft/30 p-2 bg-paper">
              <p className="label-mono">Respondents · stage</p>
              <p className="font-display text-lg leading-none mt-1">
                {respondents}
              </p>
              <p className="label-mono mt-1">{stage}</p>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

function RiskCard({
  title,
  now,
  base,
  tone,
  stageLabel,
}: {
  title: string;
  now: number;
  base: number;
  tone: "green" | "amber" | "red";
  stageLabel: string;
}) {
  const nowPct = Math.round(now * 100);
  const basePct = Math.round(base * 100);
  const deltaPp = nowPct - basePct;
  const numColor =
    tone === "red"
      ? "text-signal-red"
      : tone === "amber"
        ? "text-signal-amber"
        : "text-signal-green";
  const deltaPhrase =
    deltaPp > 5
      ? `평균보다 ${deltaPp}%p 높음 — 위험 신호`
      : deltaPp < -5
        ? `평균보다 ${Math.abs(deltaPp)}%p 낮음 — 안정적`
        : "평균과 비슷한 수준";

  return (
    <div>
      <p className="kicker mb-1">{title}</p>
      <p className="font-display leading-none">
        <span className={`text-5xl sm:text-6xl ${numColor}`}>
          {nowPct}
        </span>
        <span className="text-2xl sm:text-3xl text-ink">%</span>
      </p>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        {stageLabel} 단계 평균 회사는{" "}
        <strong className="font-medium text-ink">{basePct}%</strong> — {deltaPhrase}.
      </p>
    </div>
  );
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

function DomainBar({
  domain,
  result,
  workspace,
}: {
  domain: Domain;
  result?: DomainScoreResult;
  workspace: string;
}) {
  const score = result?.score;
  const tone =
    score === null || score === undefined
      ? "red"
      : score >= domain.thresholds.green
        ? "green"
        : score >= domain.thresholds.yellow
          ? "amber"
          : score >= domain.thresholds.red
            ? "amber"
            : "red";
  const fillClass =
    tone === "green" ? "green" : tone === "amber" ? "amber" : "red";
  const pct = score === null || score === undefined ? 0 : Math.max(2, score);

  return (
    <a
      href={`/diag/${workspace}/coach/${domain.code}`}
      className="block transition-colors hover:bg-paper-deep/40 rounded-sm group -mx-2 px-2 py-1.5"
      title={`${domain.code} ${domain.name_ko} — AI 코치와 대화`}
    >
      <article className="grid grid-cols-[100px_1fr_60px_24px] sm:grid-cols-[120px_1fr_80px_28px] items-center gap-3">
        <div className="text-right">
          <span className="font-mono text-xs">{domain.code}</span>
          <p className="font-display text-sm leading-tight">{domain.name_ko}</p>
        </div>
        <div>
          <div className="bar-track bar-bg-pattern">
            <div
              className={`bar-fill ${fillClass}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-soft">
            <span>0</span>
            <span>{domain.thresholds.red}</span>
            <span>{domain.thresholds.yellow}</span>
            <span>{domain.thresholds.green}</span>
            <span>100</span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl leading-none">
            {score === null || score === undefined ? "—" : Math.round(score)}
          </p>
          {result?.capped ? (
            <p className="label-mono !text-signal-red">capped</p>
          ) : null}
        </div>
        <span
          className="font-mono text-base text-ink-soft group-hover:text-accent transition-colors"
          aria-hidden
        >
          →
        </span>
      </article>
    </a>
  );
}

function EmptyView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">No data</p>
        <h1 className="font-display text-3xl leading-tight">
          이 워크스페이스에는 아직 응답이 없습니다
        </h1>
        <p className="mt-3 text-ink-soft">
          <span className="font-mono">{workspace}</span> 로 진단을 시작하세요.
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ErrorView({
  workspace,
  message,
}: {
  workspace: string;
  message: string;
}) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md">
        <p className="kicker mb-2 !text-signal-red">Error</p>
        <h1 className="font-display text-3xl leading-tight">
          결과를 불러오지 못했습니다
        </h1>
        <pre className="mt-3 font-mono text-xs whitespace-pre-wrap">
          {message}
        </pre>
        <a
          href={`/diag/${workspace}`}
          className="btn-secondary mt-6 inline-flex"
        >
          ← 진단 폼으로
        </a>
      </div>
    </main>
  );
}

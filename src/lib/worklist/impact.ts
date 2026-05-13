/**
 * Worklist live-impact calculator.
 *
 * 워크리스트의 task 완료 상태를 진단 결과(domain 점수)에 더해 다시 합산하여
 * "지금 이대로 → 워크리스트 100% 완료 시" 실패확률 변화를 계산.
 *
 * 클라이언트 측에서 task 상태를 토글할 때마다 즉시 재계산 → 직원이
 * "내가 이걸 완료하면 실패확률이 X% 떨어진다"를 실시간으로 본다.
 *
 * 중요: 홈 페이지·결과 페이지의 실패확률과 정확히 일치하도록
 * scoring.ts 의 `computeFailureProbability` (8-factor log-LR 모델) 을 그대로 사용.
 * 단순 단일-LR 모델을 쓰면 사용자가 두 페이지에서 다른 숫자를 보게 됨.
 */

import {
  TASKS,
  getBoostDomains,
  getBoostPoints,
  type Status,
  type Task,
} from "./catalog";
import {
  computeFailureProbability,
  computeOverallScore,
  buildScoringConfig,
  type CriticalCapRawInput,
  type DomainScoreResult,
  type DomainDef,
  type SubItemDef,
  type SubItemResponse,
  type Stage,
} from "@/lib/scoring";

/** Serializable 버전 — Date 를 ISO string 으로. */
export interface SerializedSubItemResponse {
  sub_item_code: string;
  respondent_id: string;
  belief: number;
  evidence: number | null;
  evidence_recorded_at: string; // ISO
}

/** server → client 로 넘기는 진단 baseline 묶음. */
export interface DiagnosisBaseline {
  /** aggregateRespondents 가 반환한 도메인 점수 (snapshot 아님, 실시간 재집계) */
  domainScores: DomainScoreResult[];
  /** 도메인 정의 (weight, tier) */
  domainDefs: DomainDef[];
  /** sub-item 정의 (critical 결측·data quality 평가용) */
  subDefs: SubItemDef[];
  /** 직렬화된 raw 응답 — Date → string */
  responses: SerializedSubItemResponse[];
  /** stage */
  stage: Stage;
  /** 응답자 수 — 저표본 페널티용 */
  respondentCount: number;
  /** YAML SoT 의 priors·LRs·critical_caps (serializable). client 측에서 buildScoringConfig 로 컴파일.  */
  scoringSource: {
    priors?: Record<Stage, { failure_6m: number; failure_12m: number }>;
    likelihood_ratios?: Record<string, number>;
    critical_caps?: CriticalCapRawInput[];
  };
}

export interface ImpactInputs {
  baseline: DiagnosisBaseline;
  /** 워크리스트 상태 (taskId → Status). 미명시 = "not_started" */
  taskStatuses: Record<string, Status>;
}

export interface ImpactResult {
  /** boost 적용된 도메인 점수 (0..100) */
  adjustedDomainScores: { code: string; score: number; capped100: boolean }[];
  /** 보정된 overall (0..100) — domain weighted average */
  adjustedOverall: number;
  /** baseline overall (boost 없음) */
  baselineOverall: number;
  /** 보정된 6/12개월 실패확률 (0..1) */
  adjustedFp6m: number;
  adjustedFp12m: number;
  /** baseline 실패확률 (boost 없음) — 홈/결과 페이지와 동일 */
  baselineFp6m: number;
  baselineFp12m: number;
  /** 워크리스트 완료 진행도 (필수만) 0..1 */
  mustCompletionRatio: number;
  /** 워크리스트 완료 진행도 (전체) 0..1 */
  totalCompletionRatio: number;
  /** 100% 완료 시 예상 실패확률 (0..1) — 비교용 '잠재 가능성' */
  potentialFp6mIfAllDone: number;
  potentialFp12mIfAllDone: number;
}

const STATUS_WEIGHT: Record<Status, number> = {
  not_started: 0,
  scheduled: 0.1,
  in_progress: 0.5,
  done: 1,
};

/**
 * 도메인별 boost 누적치 (점수 가산).
 * 완료된 task만큼 도메인 점수에 + boost_points * status_weight.
 */
function computeDomainBoosts(
  taskStatuses: Record<string, Status>,
  allDone: boolean = false,
): Map<string, number> {
  const boosts = new Map<string, number>();
  for (const t of TASKS) {
    const weight = allDone
      ? 1
      : STATUS_WEIGHT[taskStatuses[t.id] ?? "not_started"];
    if (weight === 0) continue;
    const points = getBoostPoints(t) * weight;
    for (const dom of getBoostDomains(t)) {
      boosts.set(dom, (boosts.get(dom) ?? 0) + points);
    }
  }
  return boosts;
}

/** baseline 도메인 점수에 boost 가산 → 새 DomainScoreResult[] 반환. */
function applyBoostsToDomainScores(
  baseline: DomainScoreResult[],
  boosts: Map<string, number>,
): DomainScoreResult[] {
  return baseline.map((d) => {
    const baseScore = d.score ?? 0;
    const add = boosts.get(d.domain) ?? 0;
    const rawScore = baseScore + add;
    const capped100 = rawScore > 100;
    const newScore = d.score === null ? null : Math.min(100, Math.max(0, rawScore));
    // tier_label 도 새 점수에 맞춰 갱신할 수 있으나 FP 계산엔 영향 없으므로 유지.
    return {
      ...d,
      score: newScore,
      capped: d.capped || capped100,
    };
  });
}

/** SerializedSubItemResponse → SubItemResponse (Date 복원). */
function deserializeResponses(
  rows: SerializedSubItemResponse[],
): SubItemResponse[] {
  return rows.map((r) => ({
    sub_item_code: r.sub_item_code,
    respondent_id: r.respondent_id,
    belief: r.belief as 1 | 2 | 3 | 4 | 5,
    evidence:
      r.evidence === null ? null : (r.evidence as 1 | 2 | 3 | 4 | 5),
    evidence_recorded_at: new Date(r.evidence_recorded_at),
  }));
}

export function computeImpact(input: ImpactInputs): ImpactResult {
  const { baseline, taskStatuses } = input;
  const responses = deserializeResponses(baseline.responses);
  const now = new Date();
  const fpOptions = {
    subDefs: baseline.subDefs,
    now,
    respondentCount: baseline.respondentCount,
  };
  // YAML SoT 의 priors·caps 를 ScoringConfig 로 컴파일 (홈 페이지와 동일 모델 보장)
  const scoringConfig = buildScoringConfig(baseline.scoringSource);

  // ── Baseline (boost 없음) — 홈 페이지·결과 페이지와 동일한 8-factor 모델 ──
  const baselineFp = computeFailureProbability(
    baseline.domainScores,
    baseline.domainDefs,
    responses,
    baseline.stage,
    scoringConfig,
    fpOptions,
  );
  const baselineOverall = computeOverallScore(
    baseline.domainScores,
    baseline.domainDefs,
  );

  // ── Adjusted (현재 task 진행 상태 반영) ──
  const adjustedBoosts = computeDomainBoosts(taskStatuses, false);
  const adjustedDomains = applyBoostsToDomainScores(
    baseline.domainScores,
    adjustedBoosts,
  );
  const adjustedFp = computeFailureProbability(
    adjustedDomains,
    baseline.domainDefs,
    responses,
    baseline.stage,
    scoringConfig,
    fpOptions,
  );
  const adjustedOverall = computeOverallScore(
    adjustedDomains,
    baseline.domainDefs,
  );

  // ── Potential (모든 task 완료 시) ──
  const potentialBoosts = computeDomainBoosts({}, true);
  const potentialDomains = applyBoostsToDomainScores(
    baseline.domainScores,
    potentialBoosts,
  );
  const potentialFp = computeFailureProbability(
    potentialDomains,
    baseline.domainDefs,
    responses,
    baseline.stage,
    scoringConfig,
    fpOptions,
  );

  // ── Completion ratios ──
  const must = TASKS.filter((t) => t.tier === "must");
  const mustDone = must.filter(
    (t) => (taskStatuses[t.id] ?? "not_started") === "done",
  ).length;
  const totalDone = TASKS.filter(
    (t) => (taskStatuses[t.id] ?? "not_started") === "done",
  ).length;

  return {
    adjustedDomainScores: adjustedDomains.map((d) => ({
      code: d.domain,
      score: d.score ?? 0,
      capped100: d.capped,
    })),
    adjustedOverall: adjustedOverall ?? 0,
    baselineOverall: baselineOverall ?? 0,
    adjustedFp6m: adjustedFp["6m"].final,
    adjustedFp12m: adjustedFp["12m"].final,
    baselineFp6m: baselineFp["6m"].final,
    baselineFp12m: baselineFp["12m"].final,
    mustCompletionRatio: must.length > 0 ? mustDone / must.length : 0,
    totalCompletionRatio: TASKS.length > 0 ? totalDone / TASKS.length : 0,
    potentialFp6mIfAllDone: potentialFp["6m"].final,
    potentialFp12mIfAllDone: potentialFp["12m"].final,
  };
}

export function readTaskStatuses(workspace: string): Record<string, Status> {
  if (typeof window === "undefined") return {};
  const out: Record<string, Status> = {};
  for (const t of TASKS) {
    const raw = window.localStorage.getItem(`worklist:${workspace}:${t.id}`);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { status: Status };
      out[t.id] = parsed.status;
    } catch {
      // ignore
    }
  }
  return out;
}

/** 백워드 호환을 위한 deprecated alias — 새 코드는 DiagnosisBaseline 사용. */
export interface DomainBaseline {
  code: string;
  weight: number;
  score: number | null;
  thresholds: { red: number; yellow: number; green: number };
  is_critical: boolean;
  likelihood_ratio?: number;
}

// Used by the lightweight default fallback in <ImpactPanel> when the page
// can't deliver real diagnosis baselines (e.g. no responses yet).
export function defaultZeroBaselines(): DomainBaseline[] {
  return [];
}

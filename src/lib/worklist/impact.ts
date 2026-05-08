/**
 * Worklist live-impact calculator.
 *
 * 워크리스트의 task 완료 상태를 진단 결과(domain 점수)에 더해 다시 합산하여
 * “지금 이대로 → 워크리스트 100% 완료 시” 실패확률 변화를 계산.
 *
 * 클라이언트 측에서 task 상태를 토글할 때마다 즉시 재계산 → 직원이
 * “내가 이걸 완료하면 실패확률이 X% 떨어진다”를 실시간으로 본다.
 */

import {
  TASKS,
  getBoostDomains,
  getBoostPoints,
  type Status,
  type Task,
} from "./catalog";

export interface DomainBaseline {
  code: string;
  weight: number;
  /** 진단 결과 점수 0..100, 미응답이면 null */
  score: number | null;
  /** 도메인 임계 (red/yellow/green) */
  thresholds: { red: number; yellow: number; green: number };
  /** critical 여부 — likelihood ratio 적용 대상 */
  is_critical: boolean;
  /** failure probability 계산용 likelihood ratio */
  likelihood_ratio?: number;
}

export interface ImpactInputs {
  baselines: DomainBaseline[];
  /** prior 6m / 12m (stage별) */
  prior_fp_6m: number;
  prior_fp_12m: number;
  /** 워크리스트 상태 (taskId → Status). 미명시 = "not_started" */
  taskStatuses: Record<string, Status>;
}

export interface ImpactResult {
  /** 현재 진단 점수 + 완료 task boost를 반영한 도메인 점수 (0..100) */
  adjustedDomainScores: { code: string; score: number; capped100: boolean }[];
  /** 보정된 overall (0..100) — domain weighted average */
  adjustedOverall: number;
  /** baseline overall (boost 없음) */
  baselineOverall: number;
  /** 보정된 6/12개월 실패확률 (0..1) */
  adjustedFp6m: number;
  adjustedFp12m: number;
  /** baseline 실패확률 (boost 없음) */
  baselineFp6m: number;
  baselineFp12m: number;
  /** 워크리스트 완료 진행도 (필수만) 0..1 */
  mustCompletionRatio: number;
  /** 워크리스트 완료 진행도 (전체) 0..1 */
  totalCompletionRatio: number;
  /** 100% 완료 시 예상 실패확률 (0..1) — 비교용 ‘잠재 가능성’ */
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
 * `unitFraction`이 0..1이면 가산 비율이 그만큼 적용 (잠재치 계산용).
 */
function computeDomainBoosts(
  taskStatuses: Record<string, Status>,
  unitFraction: number = 1,
): Map<string, number> {
  const boosts = new Map<string, number>();
  for (const t of TASKS) {
    const status = taskStatuses[t.id] ?? "not_started";
    const weight = STATUS_WEIGHT[status];
    if (weight === 0 && unitFraction === 1) continue;
    const effective = unitFraction === 1 ? weight : 1; // 100% scenario
    if (effective === 0) continue;
    const points = getBoostPoints(t) * effective;
    for (const dom of getBoostDomains(t)) {
      boosts.set(dom, (boosts.get(dom) ?? 0) + points);
    }
  }
  return boosts;
}

function applyBoosts(
  baselines: DomainBaseline[],
  boosts: Map<string, number>,
): { code: string; score: number; capped100: boolean }[] {
  return baselines.map((d) => {
    const base = d.score ?? 0;
    const add = boosts.get(d.code) ?? 0;
    const raw = base + add;
    const capped = raw > 100;
    return {
      code: d.code,
      score: Math.min(100, Math.max(0, raw)),
      capped100: capped,
    };
  });
}

function weightedAverage(
  baselines: DomainBaseline[],
  scores: { code: string; score: number }[],
): number {
  let sum = 0;
  let total = 0;
  for (const d of baselines) {
    const s = scores.find((x) => x.code === d.code)?.score ?? 0;
    sum += s * d.weight;
    total += d.weight;
  }
  return total > 0 ? sum / total : 0;
}

/**
 * 단순 베이지안 모델: 빨강 critical 도메인이 있으면 likelihood ratio를 곱한다.
 * 보정 점수가 도메인 임계 red 이하면 빨강으로 판정.
 */
function computeFp(
  baselines: DomainBaseline[],
  scores: { code: string; score: number }[],
  prior: number,
): number {
  let posteriorOdds = prior / (1 - prior);
  for (const d of baselines) {
    if (!d.is_critical) continue;
    const s = scores.find((x) => x.code === d.code)?.score ?? 0;
    if (s <= d.thresholds.red && d.likelihood_ratio) {
      posteriorOdds *= d.likelihood_ratio;
    }
  }
  const fp = posteriorOdds / (1 + posteriorOdds);
  return Math.max(0.02, Math.min(0.95, fp));
}

export function computeImpact(input: ImpactInputs): ImpactResult {
  const { baselines, prior_fp_6m, prior_fp_12m, taskStatuses } = input;

  // baseline (boost 없음)
  const baselineScores = baselines.map((d) => ({
    code: d.code,
    score: d.score ?? 0,
  }));
  const baselineOverall = weightedAverage(baselines, baselineScores);
  const baselineFp6m = computeFp(baselines, baselineScores, prior_fp_6m);
  const baselineFp12m = computeFp(baselines, baselineScores, prior_fp_12m);

  // adjusted (현재 task 상태 반영)
  const boosts = computeDomainBoosts(taskStatuses, 1);
  const adjusted = applyBoosts(baselines, boosts);
  const adjustedOverall = weightedAverage(baselines, adjusted);
  const adjustedFp6m = computeFp(baselines, adjusted, prior_fp_6m);
  const adjustedFp12m = computeFp(baselines, adjusted, prior_fp_12m);

  // potential (모든 task 완료 시)
  const allDoneStatuses: Record<string, Status> = {};
  for (const t of TASKS) allDoneStatuses[t.id] = "done";
  const potentialBoosts = computeDomainBoosts(allDoneStatuses, 1);
  const potential = applyBoosts(baselines, potentialBoosts);
  const potentialFp6m = computeFp(baselines, potential, prior_fp_6m);
  const potentialFp12m = computeFp(baselines, potential, prior_fp_12m);

  // completion ratios
  const must = TASKS.filter((t) => t.tier === "must");
  const mustDone = must.filter(
    (t) => (taskStatuses[t.id] ?? "not_started") === "done",
  ).length;
  const totalDone = TASKS.filter(
    (t) => (taskStatuses[t.id] ?? "not_started") === "done",
  ).length;

  return {
    adjustedDomainScores: adjusted,
    adjustedOverall,
    baselineOverall,
    adjustedFp6m,
    adjustedFp12m,
    baselineFp6m,
    baselineFp12m,
    mustCompletionRatio: must.length > 0 ? mustDone / must.length : 0,
    totalCompletionRatio: TASKS.length > 0 ? totalDone / TASKS.length : 0,
    potentialFp6mIfAllDone: potentialFp6m,
    potentialFp12mIfAllDone: potentialFp12m,
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

// Used by the lightweight default fallback in <ImpactPanel> when the page
// can’t deliver real diagnosis baselines (e.g. no responses yet).
export function defaultZeroBaselines(): DomainBaseline[] {
  return [];
}

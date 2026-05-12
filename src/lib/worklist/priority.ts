/**
 * Priority Score — task / sub_item 우선순위 산정.
 *
 * 모든 리스트(워크리스트 카드, 진단 sub_item)가 동일한 알고리즘으로 정렬되어
 * 직원이 "지금 가장 중요한 것 1번" 부터 명확하게 보게 한다.
 *
 *   priorityScore = tier_weight + domain_LR × 10 + stage_match_bonus
 *
 *     tier_weight    : must/critical = 100, conditional/important = 60,
 *                      recurring/supporting = 30
 *     domain_LR      : DEFAULT_LIKELIHOOD_RATIOS[domain] (A2=3.5, A7=3.0 …)
 *                      (자금 도메인 A5/A12 는 제거되어 LR 0)
 *     stage_match    : task.stage_relevance.includes(currentStage) ? 20 : 0
 *
 * UI 정렬: 내림차순. 1번 카드에 P01, 2번에 P02, … 명시.
 */

import { DEFAULT_LIKELIHOOD_RATIOS, type Stage } from "@/lib/scoring";
import type { Tier as WorklistTier, Task } from "@/lib/worklist/catalog";

/**
 * Tier 분류 → 가중치.
 *  - Worklist Tier (must/conditional/recurring) 와
 *  - Framework Tier (critical/important/supporting) 둘 다 처리.
 */
export function tierWeight(
  tier: WorklistTier | "critical" | "important" | "supporting",
): number {
  switch (tier) {
    case "must":
    case "critical":
      return 100;
    case "conditional":
    case "important":
      return 60;
    case "recurring":
    case "supporting":
      return 30;
    default:
      return 0;
  }
}

export interface PriorityInput {
  tier: WorklistTier | "critical" | "important" | "supporting";
  domain?: string;
  /** 해당 task/sub_item 이 가장 가치 있는 출시 단계들. 없으면 모든 stage 동일 처리. */
  stage_relevance?: Stage[];
}

/**
 * 우선순위 점수 산정. 높을수록 1순위.
 */
export function priorityScore(
  item: PriorityInput,
  currentStage: Stage,
): number {
  const tw = tierWeight(item.tier);
  const lr = item.domain
    ? (DEFAULT_LIKELIHOOD_RATIOS[item.domain] ?? 0)
    : 0;
  const stageBonus = item.stage_relevance?.includes(currentStage) ? 20 : 0;
  return tw + lr * 10 + stageBonus;
}

/**
 * task[] 정렬 — 우선순위 내림차순. 동점 시 원본 catalog 순서 유지 (stable sort).
 */
export function sortByPriority<T extends PriorityInput>(
  items: readonly T[],
  currentStage: Stage,
): Array<T & { _priority: number; _priorityRank: number }> {
  const withScore = items.map((t, originalIndex) => ({
    ...t,
    _priority: priorityScore(t, currentStage),
    _originalIndex: originalIndex,
  }));
  withScore.sort((a, b) => {
    if (b._priority !== a._priority) return b._priority - a._priority;
    return a._originalIndex - b._originalIndex;
  });
  return withScore.map(({ _originalIndex: _drop, ...rest }, i) => ({
    ...(rest as unknown as T),
    _priority: rest._priority,
    _priorityRank: i + 1, // P01, P02, ...
  }));
}

/**
 * UI 라벨: 1 → "P01", 9 → "P09", 10 → "P10".
 */
export function priorityLabel(rank: number): string {
  return `P${rank.toString().padStart(2, "0")}`;
}

/**
 * task의 stage_relevance 가 비어있으면 모든 stage 대상으로 간주.
 * (helper for callers that want to filter by stage without sorting)
 */
export function isRelevantForStage(task: Task, stage: Stage): boolean {
  if (!task.stage_relevance || task.stage_relevance.length === 0) return true;
  return task.stage_relevance.includes(stage);
}

/**
 * NPS 점수 계산 + 진단 evidence 버킷 매핑.
 *
 * NPS = (Promoter 9-10 %) − (Detractor 0-6 %)   범위: −100 ~ +100
 * Passive (7-8) 는 분자에 들어가지 않음 (Bain NPS playbook).
 */

import type { SurveyResponseRow } from "./types";
import { MIN_RESPONSES } from "./types";

export interface NpsBreakdown {
  total: number;
  promoters: number; // 9-10
  passives: number; // 7-8
  detractors: number; // 0-6
  nps: number; // -100 ~ +100
  reliable: boolean; // total ≥ MIN_RESPONSES
}

export function computeNps(rows: SurveyResponseRow[]): NpsBreakdown {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  let total = 0;
  for (const r of rows) {
    if (r.score === null || r.score === undefined) continue;
    if (r.score >= 9) promoters++;
    else if (r.score >= 7) passives++;
    else detractors++;
    total++;
  }
  const nps =
    total > 0
      ? Math.round(((promoters - detractors) / total) * 100)
      : 0;
  return {
    total,
    promoters,
    passives,
    detractors,
    nps,
    reliable: total >= MIN_RESPONSES,
  };
}

/**
 * NPS 점수 → A13.NPS.SCORE 의 evidence v (1..5).
 * 응답 부족 (< MIN_RESPONSES) 시 null 반환 → 진단 자동 주입 보류.
 */
export function mapNpsToEvidence(b: NpsBreakdown): 1 | 2 | 3 | 4 | 5 | null {
  if (!b.reliable) return null;
  if (b.nps >= 60) return 5;
  if (b.nps >= 40) return 4;
  if (b.nps >= 20) return 3;
  if (b.nps >= 0) return 2;
  return 1;
}

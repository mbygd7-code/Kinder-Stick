/**
 * Sean Ellis 40% 테스트 점수 계산.
 *
 * VD% = (Very Disappointed 응답 수) / (전체)
 * Sean Ellis 임계: ≥40% 면 PMF 도달로 간주.
 */

import type { SurveyResponseRow } from "./types";
import { MIN_RESPONSES } from "./types";

export interface PmfBreakdown {
  total: number;
  very_disappointed: number; // choice = 1
  somewhat_disappointed: number; // choice = 2
  not_disappointed: number; // choice = 3
  vd_percent: number; // 0..100
  reliable: boolean;
}

export function computePmf(rows: SurveyResponseRow[]): PmfBreakdown {
  let vd = 0;
  let sd = 0;
  let nd = 0;
  let total = 0;
  for (const r of rows) {
    if (r.pmf_choice === null || r.pmf_choice === undefined) continue;
    if (r.pmf_choice === 1) vd++;
    else if (r.pmf_choice === 2) sd++;
    else if (r.pmf_choice === 3) nd++;
    total++;
  }
  const vdPercent = total > 0 ? Math.round((vd / total) * 100) : 0;
  return {
    total,
    very_disappointed: vd,
    somewhat_disappointed: sd,
    not_disappointed: nd,
    vd_percent: vdPercent,
    reliable: total >= MIN_RESPONSES,
  };
}

/** VD% → A2.SE.40 evidence v (1..5). 응답 부족 시 null. */
export function mapPmfToEvidence(b: PmfBreakdown): 1 | 2 | 3 | 4 | 5 | null {
  if (!b.reliable) return null;
  if (b.vd_percent >= 55) return 5;
  if (b.vd_percent >= 40) return 4; // Sean Ellis PMF 임계
  if (b.vd_percent >= 25) return 3;
  if (b.vd_percent >= 15) return 2;
  return 1;
}

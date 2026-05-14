/**
 * Stage 라벨 단일 진실원천 (SoT).
 *
 * Appendix H-2.3: 동일 라벨이 7개 페이지에서 중복 정의되던 것을 통합.
 * 새 stage 가 추가되면 여기서만 갱신.
 */

import type { Stage } from "@/lib/scoring";

export const STAGE_LABEL: Record<Stage, string> = {
  closed_beta: "비공개 베타",
  open_beta: "공개 베타",
  ga_early: "정식 출시",
  ga_growth: "성장기",
  ga_scale: "확장기",
};

/** 짧은 라벨 (대시보드 카드용). */
export const STAGE_LABEL_SHORT: Record<Stage, string> = {
  closed_beta: "비공개 베타",
  open_beta: "공개 베타",
  ga_early: "정식 출시 (0–6m)",
  ga_growth: "성장기 (6–24m)",
  ga_scale: "확장기 (24m+)",
};

/** unknown 값 안전 조회 (legacy VC 펀딩 단계명도 매핑). */
export function getStageLabel(stage: string | null | undefined): string {
  if (!stage) return "단계 미정";
  const legacy: Record<string, string> = {
    pre_seed: "비공개 베타",
    seed: "공개 베타",
    series_a: "정식 출시",
    series_b: "성장기",
    series_c_plus: "확장기",
  };
  return (
    (STAGE_LABEL as Record<string, string>)[stage] ?? legacy[stage] ?? stage
  );
}

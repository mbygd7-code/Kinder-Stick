/**
 * Diagnosis Profile — 회사 운영 컨텍스트 기반 진단 적응(adaptation) 데이터.
 *
 * 3-Tier 모델 (사용자 의견 기반 — 2026-05-14):
 *   T1 (~70%): 보존 + 도메인 가중치 multiplier (질문 텍스트 무변경)
 *   T2 (~25%): 카드에 "보편 기준 · 귀사 컨텍스트 · 벤치마크" 참고정보 표시 (질문 무변경)
 *   T3 (~5%):  회사 특수 sub-item 추가 (A-CUSTOM. prefix, 사용자 채택 게이트 X, 거부 ✕ 만)
 *
 * 사용자 채택 게이트 없음 — 자동 적용. 거부만 1-click (T3 카드 우상단 ✕).
 * 숨김 X — 비활성은 "접힘 + 사유 표시 + 펼치기 가능 + 페널티 X" 으로 완화.
 *
 * SoT: 운영 컨텍스트(OpsContext) + 룰 (computeDiagnosisProfile) → DiagnosisProfile.
 */

export type SubItemState = "active" | "inactive" | "added";

/** 비활성된 sub-item 의 사유 + 자동 재활성화 조건 */
export interface SubItemAdaptation {
  state: "inactive";
  /** 사용자에게 보여줄 사유 (예: "유료 사용자 0명 — NPS 응답자 풀 부재") */
  reason: string;
  /** 언제 자동 재활성화되는지 (예: "유료 사용자 30명 이상 도달 시") */
  reactivation_when?: string;
  /** 어떤 룰이 트리거했는지 (디버깅용) */
  rule_id?: string;
}

/** T3 — 회사 특수 sub-item (기본 frame 에 없는 추가 카드) */
export interface AddedSubItem {
  /** "A-CUSTOM." prefix 필수 — 기본 sub-item 과 격리 */
  code: string;
  /** 어느 기존 도메인 아래에 표시할지 */
  domain: string;
  tier: "critical" | "important" | "supporting";
  /** 점수 산출 시 weight (해당 도메인 내 0..1) */
  weight_within_group: number;
  /** Belief 질문 */
  belief_q: string;
  /** 5단계 belief 앵커 */
  belief_anchors: [string, string, string, string, string];
  /** Evidence 질문 */
  evidence_q: string;
  /** 5단계 evidence 옵션 */
  evidence_options: Array<{ v: 1 | 2 | 3 | 4 | 5; label: string }>;
  /** 왜 이 카드가 추가됐는지 (사용자 표시용) */
  added_reason: string;
  /** 어떤 룰이 트리거했는지 (디버깅용) */
  rule_id?: string;
}

/** T2 — 카드에 표시할 참고 정보 (질문은 보편 그대로) */
export interface ReferenceInfo {
  /** 보편 표준 (예: "Sean Ellis 표준: n ≥ 30 = 통계 신뢰도 확보") */
  standard?: string;
  /** 귀사 컨텍스트 — 자동 계산 (예: "귀사 MAU 200 — 5%=10, 25%=50") */
  context?: string;
  /** 비교 벤치마크 — 알 때만 (예: "비슷한 회사 평균 67명") */
  benchmark?: string;
}

export interface DiagnosisProfile {
  /**
   * T1 — 도메인 가중치 multiplier.
   * 미지정 도메인은 multiplier = 1.0 (변화 없음). 범위 [0.5, 2.0].
   * 점수 산출 시 domain.weight × multiplier 로 적용.
   */
  weight_multipliers: Record<string, number>;

  /**
   * 비활성 sub-item — code → adaptation.
   * UI 에서는 접힘 + 사유 표시 + 펼치기 가능.
   * Scoring 에서는 응답 없으면 분모 제외 (missing penalty 안 매김).
   */
  sub_item_adaptations: Record<string, SubItemAdaptation>;

  /** T3 — 회사 특수 sub-item 추가 */
  added_sub_items: AddedSubItem[];

  /** T2 — sub-item code → 참고 정보 */
  reference_info: Record<string, ReferenceInfo>;

  /** 평가 시각 (cache 키 용) */
  evaluated_at: string;

  /** OpsContext 가 있어서 실제 룰이 발화됐는지 (false = 빈 default) */
  has_context: boolean;
}

/** Empty profile — OpsContext 가 없을 때 fallback. UI/scoring 모두 변화 없음. */
export function emptyDiagnosisProfile(): DiagnosisProfile {
  return {
    weight_multipliers: {},
    sub_item_adaptations: {},
    added_sub_items: [],
    reference_info: {},
    evaluated_at: new Date().toISOString(),
    has_context: false,
  };
}

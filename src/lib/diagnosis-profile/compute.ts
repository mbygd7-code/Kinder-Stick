/**
 * Diagnosis Profile compute — OpsContext → DiagnosisProfile.
 *
 * 순수 함수 (입력=OpsContext, 출력=DiagnosisProfile) — 사이드이펙트 X.
 * 모든 룰이 명시적 (한 곳에 모음).
 *
 * 룰 카테고리:
 *   T1 · weight multipliers — 도메인 가중치 ×0.5~2.0
 *   inactive — 운영 단계상 무의미한 sub-item 자동 비활성
 *   T3 · added — 회사 특수 KPI 카드 추가
 *   T2 · reference_info — 카드에 표시할 보편/컨텍스트/벤치마크 정보
 */

import type { OpsContext } from "@/app/diag/[workspace]/_ops-context-section";
import {
  emptyDiagnosisProfile,
  type AddedSubItem,
  type DiagnosisProfile,
  type ReferenceInfo,
  type SubItemAdaptation,
} from "./types";

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function ratio(
  goal: number | undefined,
  current: number | undefined,
): number | null {
  if (goal === undefined || current === undefined || current <= 0) return null;
  return goal / current;
}

function monthsSince(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30);
}

function clampMultiplier(v: number): number {
  return Math.max(0.5, Math.min(2.0, v));
}

/** 두 multiplier 가 같은 도메인에 적용될 때 더 큰 쪽 우선 (강조 누적 방지) */
function mergeMultiplier(
  map: Record<string, number>,
  domain: string,
  value: number,
) {
  const existing = map[domain] ?? 1.0;
  const merged = clampMultiplier(Math.max(existing, value));
  map[domain] = merged;
}

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────

export function computeDiagnosisProfile(
  ctx: OpsContext | null | undefined,
): DiagnosisProfile {
  if (!ctx || Object.keys(ctx).length === 0) {
    return emptyDiagnosisProfile();
  }

  const profile: DiagnosisProfile = {
    weight_multipliers: {},
    sub_item_adaptations: {},
    added_sub_items: [],
    reference_info: {},
    evaluated_at: new Date().toISOString(),
    has_context: true,
  };

  applyWeightMultiplierRules(ctx, profile.weight_multipliers);
  applyInactivationRules(ctx, profile.sub_item_adaptations);
  applyAddedRules(ctx, profile.added_sub_items);
  applyReferenceInfo(ctx, profile.reference_info);

  return profile;
}

// ────────────────────────────────────────────────────────────────
// T1 · Weight multipliers
// ────────────────────────────────────────────────────────────────

function applyWeightMultiplierRules(
  ctx: OpsContext,
  out: Record<string, number>,
) {
  // R1. 이번 달 신규 가입 목표가 현재의 2배+ → A6 ×1.4
  const acqR = ratio(ctx.goal_new_signups_monthly, ctx.new_signups_monthly);
  if (acqR !== null) {
    if (acqR >= 2) mergeMultiplier(out, "A6", 1.4);
    else if (acqR >= 1.3) mergeMultiplier(out, "A6", 1.2);
  }

  // R2. 월 이탈률 > 10% → A4 ×1.3, 5–10% → ×1.15
  if (
    ctx.churn_monthly !== undefined &&
    ctx.mau !== undefined &&
    ctx.mau > 0
  ) {
    const churn = ctx.churn_monthly / ctx.mau;
    if (churn > 0.1) mergeMultiplier(out, "A4", 1.3);
    else if (churn > 0.05) mergeMultiplier(out, "A4", 1.15);
  }

  // R3. 유료 전환 < 5% → A3 ×1.3
  if (
    ctx.paid_users_monthly !== undefined &&
    ctx.mau !== undefined &&
    ctx.mau > 0
  ) {
    if (ctx.paid_users_monthly / ctx.mau < 0.05) {
      mergeMultiplier(out, "A3", 1.3);
    }
  }

  // R4. D1 활성화 < 30% → A4 ×1.3
  if (ctx.d1_activation_rate !== undefined && ctx.d1_activation_rate < 30) {
    mergeMultiplier(out, "A4", 1.3);
  }

  // R5. NRR < 85% → A13 ×1.4
  if (ctx.nrr_rate !== undefined && ctx.nrr_rate < 85) {
    mergeMultiplier(out, "A13", 1.4);
  }

  // R6. PLC 목표 있음 → A11 ×1.2 (팀·문화·커뮤니티)
  if (
    (ctx.goal_plc_monthly !== undefined && ctx.goal_plc_monthly > 0) ||
    (ctx.goal_plc_annual !== undefined && ctx.goal_plc_annual > 0)
  ) {
    mergeMultiplier(out, "A11", 1.2);
  }

  // R7. 연간 누적 회원 목표가 현재 5배+ → A6 ×1.5 (이미 acqR 있으면 더 큰 쪽)
  const base = ctx.total_members ?? ctx.mau;
  const annualR = ratio(ctx.goal_total_members_annual, base);
  if (annualR !== null && annualR >= 5) {
    mergeMultiplier(out, "A6", 1.5);
  }

  // R8. 경쟁 압박 high → A14 ×1.3
  if (ctx.competitive_pressure === "high") {
    mergeMultiplier(out, "A14", 1.3);
  }
}

// ────────────────────────────────────────────────────────────────
// Inactive rules — 운영 단계상 의미 없는 sub-item 비활성
// ────────────────────────────────────────────────────────────────

function applyInactivationRules(
  ctx: OpsContext,
  out: Record<string, SubItemAdaptation>,
) {
  // I1. service_launched_at < 6개월 → M3 cohort retention 비활성
  const months = monthsSince(ctx.service_launched_at);
  if (months !== null && months < 6) {
    out["A2.RET.M3"] = {
      state: "inactive",
      reason: `서비스 출시 후 ${months.toFixed(1)}개월 — M3 코호트 데이터가 충분히 누적되지 않음`,
      reactivation_when: "출시 후 6개월 이후 자동 활성화",
      rule_id: "I1",
    };
  }

  // I2. paid_users_monthly = 0 → NPS / NRR 비활성
  // (응답자 풀 자체가 부재)
  if (ctx.paid_users_monthly === 0) {
    out["A13.NPS.SCORE"] = {
      state: "inactive",
      reason: "유료 사용자 0명 — NPS 응답자 풀 부재",
      reactivation_when: "유료 사용자 30명 이상 도달 시",
      rule_id: "I2",
    };
    out["A13.NRR.RATE"] = {
      state: "inactive",
      reason: "유료 사용자 0명 — NRR 산출 불가",
      reactivation_when: "유료 사용자 확보 후",
      rule_id: "I2",
    };
  }

  // I3. competitive_pressure = "low" → A14.WIN.RATE 비활성
  if (ctx.competitive_pressure === "low") {
    out["A14.WIN.RATE"] = {
      state: "inactive",
      reason: "경쟁 압박 낮음 — 직접 경쟁 win-rate 추적 시기상조",
      reactivation_when: "경쟁 압박 'medium' 이상으로 변경 시",
      rule_id: "I3",
    };
  }
}

// ────────────────────────────────────────────────────────────────
// T3 · Added — 회사 특수 sub-item
// ────────────────────────────────────────────────────────────────

const FIVE_ANCHORS_DEFAULT: [string, string, string, string, string] = [
  "전혀 아니다",
  "다소 아니다",
  "보통",
  "다소 그렇다",
  "매우 그렇다",
];

function applyAddedRules(ctx: OpsContext, out: AddedSubItem[]) {
  // A1. PLC 목표 입력 시 → A-CUSTOM.PLC.MONTHLY_NEW 추가
  const plcGoal =
    (ctx.goal_plc_monthly ?? 0) + (ctx.goal_plc_annual ?? 0);
  if (plcGoal > 0) {
    out.push({
      code: "A-CUSTOM.PLC.MONTHLY_NEW",
      domain: "A11",
      tier: "important",
      weight_within_group: 0.5,
      belief_q: "PLC(교사 학습 공동체) 운영 현황을 정기적으로 추적·기록하고 있다.",
      belief_anchors: FIVE_ANCHORS_DEFAULT,
      evidence_q: "최근 30일 신규 PLC 그룹 수는?",
      evidence_options: [
        { v: 1, label: "0 또는 미측정" },
        { v: 2, label: "1–2개" },
        { v: 3, label: "3–5개" },
        { v: 4, label: "6–10개" },
        { v: 5, label: "10개+" },
      ],
      added_reason: `PLC 목표(월 ${ctx.goal_plc_monthly ?? 0} · 연 ${ctx.goal_plc_annual ?? 0})를 입력하셨습니다 — 운영 현황 정기 추적 필요`,
      rule_id: "A1",
    });
  }

  // A2. 월간 성장 투자 예산 ≥ 1.5억 → A-CUSTOM.PAID.CHANNEL.ROAS 추가
  // (대규모 자본 투입 시 채널별 ROAS 추적 필수)
  if (
    ctx.monthly_growth_budget_krw !== undefined &&
    ctx.monthly_growth_budget_krw >= 150_000_000
  ) {
    out.push({
      code: "A-CUSTOM.PAID.CHANNEL.ROAS",
      domain: "A6",
      tier: "critical",
      weight_within_group: 0.7,
      belief_q: "유료 채널별 ROAS(광고비 회수율) 를 주간 단위로 추적·비교한다.",
      belief_anchors: FIVE_ANCHORS_DEFAULT,
      evidence_q: "현재 유료 채널 중 ROAS ≥ 1.5x 달성 채널은?",
      evidence_options: [
        { v: 1, label: "0개 또는 ROAS 미측정" },
        { v: 2, label: "1개" },
        { v: 3, label: "2개" },
        { v: 4, label: "3개" },
        { v: 5, label: "4개 이상" },
      ],
      added_reason: `월 ${(ctx.monthly_growth_budget_krw / 100_000_000).toFixed(1)}억 성장 예산 — 채널별 ROAS 정밀 추적이 자본 효율 결정`,
      rule_id: "A2",
    });
  }

  // A3. 경쟁 압박 high → A-CUSTOM.COMPETITIVE.DEFENSE 추가
  if (ctx.competitive_pressure === "high") {
    out.push({
      code: "A-CUSTOM.COMPETITIVE.DEFENSE",
      domain: "A14",
      tier: "important",
      weight_within_group: 0.5,
      belief_q: "경쟁사 신규 기능·가격 변동을 분기별로 추적·대응 계획을 세운다.",
      belief_anchors: FIVE_ANCHORS_DEFAULT,
      evidence_q: "최근 90일 안에 경쟁사 정찰 리뷰 (intel review) 를 진행한 횟수는?",
      evidence_options: [
        { v: 1, label: "0회" },
        { v: 2, label: "1회 (피상)" },
        { v: 3, label: "1회 (정량 비교)" },
        { v: 4, label: "2회 이상" },
        { v: 5, label: "월 1회 정기" },
      ],
      added_reason: "경쟁 압박 'high' 로 입력하셨습니다 — 정찰·대응 체계 점검 필요",
      rule_id: "A3",
    });
  }
}

// ────────────────────────────────────────────────────────────────
// T2 · Reference info — 카드에 표시할 보편 기준 + 컨텍스트
// ────────────────────────────────────────────────────────────────

function applyReferenceInfo(
  ctx: OpsContext,
  out: Record<string, ReferenceInfo>,
) {
  // RI1. A2.SE.40 — Sean Ellis 표본 가이드
  if (ctx.mau !== undefined && ctx.mau > 0) {
    const five = Math.max(1, Math.round(ctx.mau * 0.05));
    const twentyFive = Math.round(ctx.mau * 0.25);
    out["A2.SE.40"] = {
      standard:
        "Sean Ellis 표준: n ≥ 30 = 통계 신뢰도 확보, VD ≥ 40% = PMF 도달 신호",
      context: `귀사 MAU ${ctx.mau.toLocaleString("ko-KR")} 기준 — 5% 표본=${five.toLocaleString("ko-KR")}명, 25% 표본=${twentyFive.toLocaleString("ko-KR")}명. 어떤 방식 (1:1 / 비동기 폼 / 그룹 세션) 으로 어느 규모를 잡을지는 회사가 결정.`,
      benchmark: "영유아 EdTech 일반: VD 25–45% 대 (β·early-GA 단계)",
    };
  }

  // RI2. A4.ACT.D1 — D1 활성화 표본
  if (
    ctx.new_signups_monthly !== undefined &&
    ctx.new_signups_monthly > 0
  ) {
    out["A4.ACT.D1"] = {
      standard:
        "영유아 EdTech D1 활성화 일반 기준: ≥30% 양호, ≥50% 우수",
      context: `귀사 월 신규 가입 ${ctx.new_signups_monthly.toLocaleString("ko-KR")}명 — 표본 충분.`,
    };
  }

  // RI3. A4.HABIT.WAU_MAU — 습관 형성
  if (
    ctx.mau !== undefined &&
    ctx.wau !== undefined &&
    ctx.mau > 0
  ) {
    const ratio = (ctx.wau / ctx.mau) * 100;
    out["A4.HABIT.WAU_MAU"] = {
      standard: "WAU/MAU 기준: ≥50% 양호, ≥30% 보통, <30% 약함",
      context: `귀사 현재 WAU/MAU = ${ratio.toFixed(1)}% (WAU ${ctx.wau.toLocaleString("ko-KR")} / MAU ${ctx.mau.toLocaleString("ko-KR")})`,
    };
  }

  // RI4. A13.NRR.RATE — NRR 표준
  if (ctx.paid_users_monthly !== undefined && ctx.paid_users_monthly > 0) {
    out["A13.NRR.RATE"] = {
      standard:
        "NRR 표준: ≥120% 우수, 100–120% 양호, 85–100% 주의, <85% 위험",
      context:
        ctx.nrr_rate !== undefined
          ? `귀사 NRR ${ctx.nrr_rate.toFixed(1)}%`
          : "NRR 측정값 미입력 — 입력하면 자동 비교",
    };
  }

  // RI5. A13.NPS.SCORE — NPS 표준
  if (ctx.paid_users_monthly !== undefined && ctx.paid_users_monthly > 0) {
    out["A13.NPS.SCORE"] = {
      standard: "NPS 기준: +50 우수, +30 양호, 0 보통, 음수 위험",
      context: `귀사 유료 사용자 ${ctx.paid_users_monthly.toLocaleString("ko-KR")}명 — 권장 응답 n ≥ ${Math.max(30, Math.round(ctx.paid_users_monthly * 0.1))}명`,
    };
  }
}

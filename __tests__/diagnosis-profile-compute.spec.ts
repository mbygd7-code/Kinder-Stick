/**
 * Unit tests — DiagnosisProfile compute rules.
 *
 * 14 룰을 다음 카테고리로 검증:
 *   T1 weight multipliers (8 rules: R1-R8)
 *   Inactivation (3 rules: I1-I3)
 *   T3 added sub-items (3 rules: A1-A3)
 *
 * 추가로:
 *   - Reference info (5 RI rules)
 *   - 빈 컨텍스트 → empty profile
 *   - Multiplier 중첩 시 max 우선 (mergeMultiplier)
 *   - 데이터 없음 → 룰 발화 안 함 (false-safe)
 */

import { describe, it, expect } from "vitest";
import { computeDiagnosisProfile } from "@/lib/diagnosis-profile/compute";
import { emptyDiagnosisProfile } from "@/lib/diagnosis-profile/types";
import type { OpsContext } from "@/app/diag/[workspace]/_ops-context-section";

// ────────────────────────────────────────────────────────────────
// 기본 / 빈 입력
// ────────────────────────────────────────────────────────────────

describe("computeDiagnosisProfile · 빈 입력", () => {
  it("null 입력 시 empty profile", () => {
    const p = computeDiagnosisProfile(null);
    expect(p.has_context).toBe(false);
    expect(p.weight_multipliers).toEqual({});
    expect(p.sub_item_adaptations).toEqual({});
    expect(p.added_sub_items).toEqual([]);
    expect(p.reference_info).toEqual({});
  });

  it("undefined 입력 시 empty profile", () => {
    const p = computeDiagnosisProfile(undefined);
    expect(p.has_context).toBe(false);
  });

  it("빈 객체 {} 입력 시 empty profile", () => {
    const p = computeDiagnosisProfile({});
    expect(p.has_context).toBe(false);
    expect(p.weight_multipliers).toEqual({});
  });

  it("emptyDiagnosisProfile 헬퍼는 has_context=false", () => {
    expect(emptyDiagnosisProfile().has_context).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// T1 · Weight Multipliers
// ────────────────────────────────────────────────────────────────

describe("T1 · Weight Multipliers", () => {
  it("R1a — 월 신규 가입 목표가 2배+ → A6 ×1.4", () => {
    const ctx: OpsContext = {
      new_signups_monthly: 100,
      goal_new_signups_monthly: 300, // 3배
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A6).toBe(1.4);
  });

  it("R1b — 월 신규 가입 목표가 1.3–2배 → A6 ×1.2", () => {
    const ctx: OpsContext = {
      new_signups_monthly: 100,
      goal_new_signups_monthly: 150, // 1.5배
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A6).toBe(1.2);
  });

  it("R1c — 목표 1.3배 미만 → A6 발화 없음", () => {
    const ctx: OpsContext = {
      new_signups_monthly: 100,
      goal_new_signups_monthly: 110,
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A6).toBeUndefined();
  });

  it("R2a — 월 이탈률 > 10% → A4 ×1.3", () => {
    const ctx: OpsContext = { mau: 1000, churn_monthly: 150 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A4).toBe(1.3);
  });

  it("R2b — 월 이탈률 5–10% → A4 ×1.15", () => {
    const ctx: OpsContext = { mau: 1000, churn_monthly: 80 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A4).toBe(1.15);
  });

  it("R3 — 유료 전환 < 5% → A3 ×1.3", () => {
    const ctx: OpsContext = { mau: 1000, paid_users_monthly: 40 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A3).toBe(1.3);
  });

  it("R4 — D1 활성화 < 30% → A4 ×1.3", () => {
    const ctx: OpsContext = { d1_activation_rate: 25 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A4).toBe(1.3);
  });

  it("R5 — NRR < 85% → A13 ×1.4", () => {
    const ctx: OpsContext = { nrr_rate: 70 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A13).toBe(1.4);
  });

  it("R6 — PLC 목표 있음 → A11 ×1.2", () => {
    const ctx: OpsContext = { goal_plc_monthly: 5 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A11).toBe(1.2);
  });

  it("R7 — 연간 누적 회원 목표 5배+ → A6 ×1.5", () => {
    const ctx: OpsContext = {
      total_members: 1000,
      goal_total_members_annual: 6000,
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A6).toBe(1.5);
  });

  it("R8 — 경쟁 압박 high → A14 ×1.3", () => {
    const ctx: OpsContext = { competitive_pressure: "high" };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A14).toBe(1.3);
  });

  it("Multiplier 중첩 — 더 큰 값 우선 (mergeMultiplier)", () => {
    // R1 → A6 ×1.2, R7 → A6 ×1.5 — 후자가 우선
    const ctx: OpsContext = {
      new_signups_monthly: 100,
      goal_new_signups_monthly: 150, // R1b: A6 ×1.2
      total_members: 1000,
      goal_total_members_annual: 6000, // R7: A6 ×1.5
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A6).toBe(1.5);
  });

  it("clamp — multiplier 가 2.0 초과 못함", () => {
    // 매우 큰 multiplier 들 결합 — clamp 작동 확인
    const ctx: OpsContext = {
      d1_activation_rate: 5, // R4: A4 ×1.3
      mau: 1000,
      churn_monthly: 200, // R2a: A4 ×1.3 (clamp 후에도 ≤2.0)
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A4).toBeLessThanOrEqual(2.0);
    expect(p.weight_multipliers.A4).toBeGreaterThanOrEqual(0.5);
  });

  it("데이터 없음 → 룰 발화 안 함 (false-safe)", () => {
    const ctx: OpsContext = { team_size: 5 }; // 어떤 룰도 안 잡힘
    const p = computeDiagnosisProfile(ctx);
    expect(Object.keys(p.weight_multipliers)).toHaveLength(0);
  });

  it("MAU=0 일 때 churn/paid 룰 발화 안 함 (division-by-zero 방지)", () => {
    const ctx: OpsContext = {
      mau: 0,
      churn_monthly: 100,
      paid_users_monthly: 50,
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A4).toBeUndefined();
    expect(p.weight_multipliers.A3).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// Inactivation rules
// ────────────────────────────────────────────────────────────────

describe("Inactivation Rules", () => {
  it("I1 — 출시 <6개월 → A2.RET.M3 비활성", () => {
    const recent = new Date();
    recent.setMonth(recent.getMonth() - 3); // 3개월 전
    const ctx: OpsContext = {
      service_launched_at: recent.toISOString().slice(0, 10),
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.sub_item_adaptations["A2.RET.M3"]?.state).toBe("inactive");
    expect(p.sub_item_adaptations["A2.RET.M3"]?.rule_id).toBe("I1");
  });

  it("I1 negative — 출시 ≥6개월 → A2.RET.M3 활성 유지", () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 12); // 1년 전
    const ctx: OpsContext = {
      service_launched_at: old.toISOString().slice(0, 10),
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.sub_item_adaptations["A2.RET.M3"]).toBeUndefined();
  });

  it("I2 — paid_users_monthly = 0 → NPS, NRR 비활성", () => {
    const ctx: OpsContext = { paid_users_monthly: 0 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.sub_item_adaptations["A13.NPS.SCORE"]?.state).toBe("inactive");
    expect(p.sub_item_adaptations["A13.NRR.RATE"]?.state).toBe("inactive");
  });

  it("I2 negative — paid > 0 시 NPS/NRR 활성 유지", () => {
    const ctx: OpsContext = { paid_users_monthly: 50 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.sub_item_adaptations["A13.NPS.SCORE"]).toBeUndefined();
    expect(p.sub_item_adaptations["A13.NRR.RATE"]).toBeUndefined();
  });

  it("I3 — 경쟁 압박 low → A14.WIN.RATE 비활성", () => {
    const ctx: OpsContext = { competitive_pressure: "low" };
    const p = computeDiagnosisProfile(ctx);
    expect(p.sub_item_adaptations["A14.WIN.RATE"]?.state).toBe("inactive");
  });

  it("I3 negative — 경쟁 압박 medium/high → 활성 유지", () => {
    const ctxMed: OpsContext = { competitive_pressure: "medium" };
    expect(
      computeDiagnosisProfile(ctxMed).sub_item_adaptations["A14.WIN.RATE"],
    ).toBeUndefined();
    const ctxHigh: OpsContext = { competitive_pressure: "high" };
    expect(
      computeDiagnosisProfile(ctxHigh).sub_item_adaptations["A14.WIN.RATE"],
    ).toBeUndefined();
  });

  it("비활성 카드는 reason + reactivation_when 안내 포함", () => {
    const ctx: OpsContext = { paid_users_monthly: 0 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.sub_item_adaptations["A13.NPS.SCORE"]?.reason).toContain(
      "유료",
    );
    expect(
      p.sub_item_adaptations["A13.NPS.SCORE"]?.reactivation_when,
    ).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────
// T3 · Added sub-items
// ────────────────────────────────────────────────────────────────

describe("T3 · Added sub-items", () => {
  it("A1 — PLC 월 목표 → A-CUSTOM.PLC.MONTHLY_NEW (A11)", () => {
    const ctx: OpsContext = { goal_plc_monthly: 5 };
    const p = computeDiagnosisProfile(ctx);
    const added = p.added_sub_items.find(
      (a) => a.code === "A-CUSTOM.PLC.MONTHLY_NEW",
    );
    expect(added).toBeDefined();
    expect(added?.domain).toBe("A11");
    expect(added?.evidence_options).toHaveLength(5);
  });

  it("A1 — PLC 연 목표만으로도 발화", () => {
    const ctx: OpsContext = { goal_plc_annual: 30 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.added_sub_items.find((a) => a.code.includes("PLC"))).toBeDefined();
  });

  it("A1 negative — PLC 목표 없음 → 추가 카드 없음", () => {
    const p = computeDiagnosisProfile({ team_size: 5 });
    expect(p.added_sub_items.find((a) => a.code.includes("PLC"))).toBeUndefined();
  });

  it("A2 — 월 1.5억+ 예산 → A-CUSTOM.PAID.CHANNEL.ROAS (A6)", () => {
    const ctx: OpsContext = { monthly_growth_budget_krw: 200_000_000 };
    const p = computeDiagnosisProfile(ctx);
    const added = p.added_sub_items.find(
      (a) => a.code === "A-CUSTOM.PAID.CHANNEL.ROAS",
    );
    expect(added).toBeDefined();
    expect(added?.domain).toBe("A6");
    expect(added?.tier).toBe("critical");
  });

  it("A2 negative — 예산 1.5억 미만 → 발화 안 함", () => {
    const ctx: OpsContext = { monthly_growth_budget_krw: 100_000_000 };
    const p = computeDiagnosisProfile(ctx);
    expect(
      p.added_sub_items.find((a) => a.code.includes("ROAS")),
    ).toBeUndefined();
  });

  it("A3 — 경쟁 압박 high → A-CUSTOM.COMPETITIVE.DEFENSE (A14)", () => {
    const ctx: OpsContext = { competitive_pressure: "high" };
    const p = computeDiagnosisProfile(ctx);
    const added = p.added_sub_items.find(
      (a) => a.code === "A-CUSTOM.COMPETITIVE.DEFENSE",
    );
    expect(added).toBeDefined();
    expect(added?.domain).toBe("A14");
  });

  it("A3 negative — 경쟁 low/medium 시 발화 안 함", () => {
    const p1 = computeDiagnosisProfile({ competitive_pressure: "low" });
    const p2 = computeDiagnosisProfile({ competitive_pressure: "medium" });
    expect(
      p1.added_sub_items.find((a) => a.code.includes("COMPETITIVE")),
    ).toBeUndefined();
    expect(
      p2.added_sub_items.find((a) => a.code.includes("COMPETITIVE")),
    ).toBeUndefined();
  });

  it("모든 추가 카드는 A-CUSTOM. prefix + 5단계 evidence", () => {
    const ctx: OpsContext = {
      goal_plc_monthly: 3,
      monthly_growth_budget_krw: 300_000_000,
      competitive_pressure: "high",
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.added_sub_items.length).toBeGreaterThanOrEqual(3);
    for (const a of p.added_sub_items) {
      expect(a.code).toMatch(/^A-CUSTOM\./);
      expect(a.evidence_options).toHaveLength(5);
      expect(a.belief_anchors).toHaveLength(5);
      expect(a.added_reason).toBeTruthy();
    }
  });
});

// ────────────────────────────────────────────────────────────────
// T2 · Reference Info
// ────────────────────────────────────────────────────────────────

describe("T2 · Reference Info", () => {
  it("RI1 — A2.SE.40 표본 가이드 (MAU 있음)", () => {
    const ctx: OpsContext = { mau: 2000 };
    const p = computeDiagnosisProfile(ctx);
    const ri = p.reference_info["A2.SE.40"];
    expect(ri?.standard).toContain("Sean Ellis");
    expect(ri?.context).toContain("2,000");
    expect(ri?.context).toContain("100"); // 5% 표본 = 100
  });

  it("RI2 — A4.ACT.D1 (신규 가입 있음)", () => {
    const ctx: OpsContext = { new_signups_monthly: 500 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.reference_info["A4.ACT.D1"]?.standard).toContain("D1 활성화");
  });

  it("RI3 — A4.HABIT.WAU_MAU 실측 비율 계산", () => {
    const ctx: OpsContext = { mau: 1000, wau: 400 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.reference_info["A4.HABIT.WAU_MAU"]?.context).toContain("40.0%");
  });

  it("RI4 — A13.NRR.RATE 표준 + 귀사 값", () => {
    const ctx: OpsContext = { paid_users_monthly: 100, nrr_rate: 95 };
    const p = computeDiagnosisProfile(ctx);
    const ri = p.reference_info["A13.NRR.RATE"];
    expect(ri?.standard).toContain("NRR");
    expect(ri?.context).toContain("95");
  });

  it("RI5 — A13.NPS.SCORE 권장 응답 수 계산", () => {
    const ctx: OpsContext = { paid_users_monthly: 500 };
    const p = computeDiagnosisProfile(ctx);
    expect(p.reference_info["A13.NPS.SCORE"]?.context).toContain("50");
  });

  it("데이터 없음 → reference_info 비어있음", () => {
    const p = computeDiagnosisProfile({ team_size: 3 });
    expect(Object.keys(p.reference_info)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// Integration · 실제 회사 시나리오
// ────────────────────────────────────────────────────────────────

describe("Integration · 시나리오", () => {
  it("Closed beta 단계 · 초기 회사 — 비활성 다수 + 가중치 일부", () => {
    const recentLaunch = new Date();
    recentLaunch.setMonth(recentLaunch.getMonth() - 2);
    const ctx: OpsContext = {
      service_launched_at: recentLaunch.toISOString().slice(0, 10),
      mau: 50,
      wau: 20,
      new_signups_monthly: 10,
      paid_users_monthly: 0, // 베타라 유료 없음
      competitive_pressure: "low",
      team_size: 3,
    };
    const p = computeDiagnosisProfile(ctx);
    // I1: M3 비활성 (출시 2개월)
    expect(p.sub_item_adaptations["A2.RET.M3"]?.state).toBe("inactive");
    // I2: NPS/NRR 비활성
    expect(p.sub_item_adaptations["A13.NPS.SCORE"]?.state).toBe("inactive");
    // I3: A14 WIN.RATE 비활성
    expect(p.sub_item_adaptations["A14.WIN.RATE"]?.state).toBe("inactive");
    expect(p.has_context).toBe(true);
  });

  it("GA Growth 단계 · 신규 가속 회사 — 다중 multiplier + 추가 카드", () => {
    const ctx: OpsContext = {
      mau: 5000,
      wau: 2200,
      new_signups_monthly: 800,
      goal_new_signups_monthly: 2000, // R1: A6 ×1.4
      paid_users_monthly: 300,
      monthly_growth_budget_krw: 200_000_000, // A2: ROAS 카드 추가
      competitive_pressure: "high", // R8: A14 ×1.3, A3: COMPETITIVE 카드
      goal_plc_annual: 50, // R6: A11 ×1.2, A1: PLC 카드
    };
    const p = computeDiagnosisProfile(ctx);
    expect(p.weight_multipliers.A6).toBe(1.4);
    expect(p.weight_multipliers.A14).toBe(1.3);
    expect(p.weight_multipliers.A11).toBe(1.2);
    expect(p.added_sub_items.length).toBe(3); // PLC + ROAS + COMPETITIVE
  });

  it("정합성 — evaluated_at ISO timestamp 형식", () => {
    const p = computeDiagnosisProfile({ mau: 100 });
    expect(p.evaluated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

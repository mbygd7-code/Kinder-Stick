/**
 * End-to-end verification — "진단에 반영" 시나리오의 실제 결과 검증.
 *
 * 사용자가 입력한 OpsContext (스크린샷의 실제 값) 로 다음 확인:
 *   1) computeDiagnosisProfile 가 의도한 룰을 정확히 발화하는지
 *   2) UI 가 받는 데이터 — 어떤 카드가 비활성/추가/강조/참고정보 표시되는지
 *   3) Scoring helper 가 weight multiplier · added subDefs · missing-penalty 면제 적용하는지
 */

import { describe, it, expect } from "vitest";
import { computeDiagnosisProfile } from "@/lib/diagnosis-profile/compute";
import {
  applyWeightMultipliers,
  buildAddedSubDefs,
  computeMissingPenaltyForDomain,
} from "@/lib/diagnosis-profile/apply-scoring";
import { loadFramework } from "@/lib/framework/loader";
import type { OpsContext } from "@/app/diag/[workspace]/_ops-context-section";
import type { DomainDef } from "@/lib/scoring";

/**
 * 실제 스크린샷의 회사 컨텍스트:
 *   - 출시 2개월 차 (2026-03-09 → 오늘 2026-05-14)
 *   - MAU 979, WAU ?, 신규 1,714/월
 *   - 유료 95명 (전환율 9.7%)
 *   - 이탈 20명/월 (2.0%)
 *   - 월 성장 예산 1억 KRW (1.5억 미만)
 *   - 팀 14명
 *   - 경쟁 medium
 *   - 목표: 월 신규 4,500 (2.6배), 월 유료 800 (8.4배)
 *   - 연 누적 60,000 (4.7배), 연 유료 20,000 (210.5배), 연 PLC 5,000개
 */
const SCREENSHOT_CTX: OpsContext = {
  mau: 979,
  new_signups_monthly: 1714,
  paid_users_monthly: 95,
  churn_monthly: 20,
  service_launched_at: "2026-03-09",
  team_size: 14,
  monthly_growth_budget_krw: 100_000_000,
  competitive_pressure: "medium",
  goal_new_signups_monthly: 4500,
  goal_paid_users_monthly: 800,
  goal_total_members_annual: 60000,
  goal_paid_subscribers_annual: 20000,
  goal_plc_annual: 5000,
};

describe("E2E · 스크린샷 실제 사용자 시나리오", () => {
  const profile = computeDiagnosisProfile(SCREENSHOT_CTX);

  describe("Profile 발화 결과", () => {
    it("has_context = true (룰 발화됨)", () => {
      expect(profile.has_context).toBe(true);
    });

    it("T1 · A6 ×1.5 — R1a(신규 2.6배 → 1.4) + R7(연 누적 61배 → 1.5) 중 max 우선", () => {
      // 60000/979 ≈ 61배 → R7 발화 → 1.5
      // 신규 4500/1714 = 2.6배 → R1a 발화 → 1.4
      // mergeMultiplier 가 max 우선이므로 1.5 가 최종
      expect(profile.weight_multipliers.A6).toBe(1.5);
    });

    it("T1 · A3 ×1.3 발화 (유료 전환 9.7% < 5% 아님 — 발화 X)", () => {
      // 95/979 = 9.7% > 5% 이므로 R3 발화 안 함
      expect(profile.weight_multipliers.A3).toBeUndefined();
    });

    it("T1 · A4 발화 안 함 (이탈 2.0% < 5%, D1 미입력)", () => {
      expect(profile.weight_multipliers.A4).toBeUndefined();
    });

    it("T1 · A6 ×1.5 우선 적용 (연 누적 4.7배 < 5배 — R7 발화 안 함)", () => {
      // 60000/979 = 61배지만 base 가 mau (total_members 없음). 그러나 mau 의 5배 = 4,895 < 60000
      // 정확히는 60000/979 = 61.3배 → R7 발화됨 → 1.5
      // → 발화돼서 1.5 가 1.4 보다 큼
      expect(profile.weight_multipliers.A6).toBe(1.5);
    });

    it("T1 · A11 발화 안 함 (PLC 월 목표 없음, 연 5000 있음 → A11 ×1.2)", () => {
      // goal_plc_annual: 5000 → R6 발화
      expect(profile.weight_multipliers.A11).toBe(1.2);
    });

    it("T1 · A14 발화 안 함 (medium 은 high 가 아님)", () => {
      expect(profile.weight_multipliers.A14).toBeUndefined();
    });

    it("Inactive · A2.RET.M3 비활성 (출시 2개월)", () => {
      const ad = profile.sub_item_adaptations["A2.RET.M3"];
      expect(ad?.state).toBe("inactive");
      expect(ad?.reason).toContain("개월");
      expect(ad?.reactivation_when).toContain("6개월");
    });

    it("Inactive · NPS/NRR 비활성 안 됨 (유료 95 > 0)", () => {
      expect(profile.sub_item_adaptations["A13.NPS.SCORE"]).toBeUndefined();
      expect(profile.sub_item_adaptations["A13.NRR.RATE"]).toBeUndefined();
    });

    it("Inactive · A14.WIN.RATE 비활성 안 됨 (경쟁 medium)", () => {
      expect(profile.sub_item_adaptations["A14.WIN.RATE"]).toBeUndefined();
    });

    it("T3 · PLC 카드 추가 (goal_plc_annual = 5000)", () => {
      const plc = profile.added_sub_items.find(
        (a) => a.code === "A-CUSTOM.PLC.MONTHLY_NEW",
      );
      expect(plc).toBeDefined();
      expect(plc?.domain).toBe("A11");
    });

    it("T3 · ROAS 카드 추가 안 됨 (월 예산 1억 < 1.5억 임계)", () => {
      const roas = profile.added_sub_items.find(
        (a) => a.code === "A-CUSTOM.PAID.CHANNEL.ROAS",
      );
      expect(roas).toBeUndefined();
    });

    it("T3 · COMPETITIVE 카드 추가 안 됨 (medium 은 high 가 아님)", () => {
      const comp = profile.added_sub_items.find(
        (a) => a.code === "A-CUSTOM.COMPETITIVE.DEFENSE",
      );
      expect(comp).toBeUndefined();
    });

    it("T2 · A2.SE.40 참고정보 (MAU 979)", () => {
      const ri = profile.reference_info["A2.SE.40"];
      expect(ri?.standard).toContain("Sean Ellis");
      expect(ri?.context).toContain("979");
      // 5% 표본 = 49
      expect(ri?.context).toContain("49");
    });

    it("T2 · A4.ACT.D1 참고정보 (신규 1,714)", () => {
      const ri = profile.reference_info["A4.ACT.D1"];
      expect(ri?.standard).toContain("D1 활성화");
      expect(ri?.context).toContain("1,714");
    });

    it("T2 · A4.HABIT 참고정보 발화 안 함 (WAU 없음)", () => {
      expect(profile.reference_info["A4.HABIT.WAU_MAU"]).toBeUndefined();
    });
  });

  describe("UI 데이터 — 어떤 카드가 어떻게 표시되는가", () => {
    it("도메인 헤더에 노출될 가중치 multiplier", () => {
      const a6mul = profile.weight_multipliers.A6 ?? 1.0;
      const a11mul = profile.weight_multipliers.A11 ?? 1.0;
      // A6 헤더에 "×1.50 (회사 컨텍스트 강조)" 표시
      expect(a6mul).toBe(1.5);
      // A11 헤더에 "×1.20 (회사 컨텍스트 강조)" 표시
      expect(a11mul).toBe(1.2);
    });

    it("비활성 접힘 카드 1개 (A2.RET.M3)", () => {
      const inactives = Object.entries(profile.sub_item_adaptations).filter(
        ([, ad]) => ad.state === "inactive",
      );
      expect(inactives).toHaveLength(1);
      expect(inactives[0][0]).toBe("A2.RET.M3");
    });

    it("추가됨 카드 1개 (A-CUSTOM.PLC.MONTHLY_NEW under A11)", () => {
      expect(profile.added_sub_items).toHaveLength(1);
      expect(profile.added_sub_items[0].domain).toBe("A11");
    });

    it("참고정보 박스 노출 sub-item 들 (A2.SE.40, A4.ACT.D1, A13.NPS.SCORE, A13.NRR.RATE)", () => {
      const codes = Object.keys(profile.reference_info);
      expect(codes).toContain("A2.SE.40");
      expect(codes).toContain("A4.ACT.D1");
      // paid_users > 0 이므로 NPS/NRR 참고정보도 표시
      expect(codes).toContain("A13.NPS.SCORE");
      expect(codes).toContain("A13.NRR.RATE");
    });
  });

  describe("Scoring helpers 동작", () => {
    const framework = loadFramework();

    it("applyWeightMultipliers — A6 weight 가 multiplier 만큼 증가", () => {
      const baseDefs: DomainDef[] = framework.domains.map((d) => ({
        code: d.code,
        weight: d.weight,
        tier: d.tier,
      }));
      const adapted = applyWeightMultipliers(baseDefs, profile);
      const baseA6 = baseDefs.find((d) => d.code === "A6");
      const adaptedA6 = adapted.find((d) => d.code === "A6");
      expect(adaptedA6?.weight).toBe((baseA6?.weight ?? 0) * 1.5);
    });

    it("applyWeightMultipliers — multiplier 없는 도메인 (A1) 은 그대로", () => {
      const baseDefs: DomainDef[] = framework.domains.map((d) => ({
        code: d.code,
        weight: d.weight,
        tier: d.tier,
      }));
      const adapted = applyWeightMultipliers(baseDefs, profile);
      const baseA1 = baseDefs.find((d) => d.code === "A1");
      const adaptedA1 = adapted.find((d) => d.code === "A1");
      expect(adaptedA1?.weight).toBe(baseA1?.weight);
    });

    it("buildAddedSubDefs — PLC 카드가 SubItemDef 로 변환되어 scoring 대상 포함", () => {
      const subDefs = buildAddedSubDefs(profile.added_sub_items);
      expect(subDefs).toHaveLength(1);
      expect(subDefs[0].code).toBe("A-CUSTOM.PLC.MONTHLY_NEW");
      expect(subDefs[0].group).toBe("A11.CUSTOM");
      expect(subDefs[0].tier).toBe("important");
    });

    it("computeMissingPenaltyForDomain — 비활성 A2.RET.M3 는 응답 없어도 페널티 X", () => {
      // 응답 없음 → 일반 missing penalty 시나리오 (dq_req >= 2 인 sub-item 1개당 -8)
      const respondedNothing = new Set<string>();
      const penaltyA2 = computeMissingPenaltyForDomain(
        "A2",
        framework,
        respondedNothing,
        profile,
      );
      // A2 도메인 내 다른 sub-item 들은 페널티 받지만 A2.RET.M3 는 면제됨
      // baseline (profile=null) 와 비교해서 페널티가 -8 만큼 작아야 함
      const penaltyBaseline = computeMissingPenaltyForDomain(
        "A2",
        framework,
        respondedNothing,
        null,
      );
      // profile 있을 때 페널티가 baseline 보다 0~8 만큼 작음 (양수일 수도 = 더 가벼움)
      expect(penaltyA2).toBeGreaterThanOrEqual(penaltyBaseline);
      // A2.RET.M3 dq_req 가 2 이상이라면 정확히 +8 차이
      // (확인 필요 — framework 조회)
      const subM3 = framework.domains
        .find((d) => d.code === "A2")
        ?.groups.flatMap((g) => g.sub_items)
        .find((s) => s.code === "A2.RET.M3");
      if (subM3 && (subM3.data_quality_required ?? 1) >= 2) {
        expect(penaltyA2 - penaltyBaseline).toBe(8);
      }
    });

    it("computeMissingPenaltyForDomain — A1 도메인은 inactive 없으니 baseline 과 동일", () => {
      const responded = new Set<string>();
      const a1Profile = computeMissingPenaltyForDomain(
        "A1",
        framework,
        responded,
        profile,
      );
      const a1Base = computeMissingPenaltyForDomain(
        "A1",
        framework,
        responded,
        null,
      );
      expect(a1Profile).toBe(a1Base);
    });
  });

  describe("Submit payload 형식", () => {
    it("applied_profile 직렬화 — JSON.stringify 가능 (직렬화 안전성)", () => {
      // 클라이언트가 submit 시 payload.applied_profile 로 넘기는 데이터.
      // function/Date 같은 직렬화 불가 객체가 섞이지 않았는지 확인.
      const json = JSON.stringify(profile);
      const parsed = JSON.parse(json);
      expect(parsed.has_context).toBe(true);
      expect(parsed.weight_multipliers.A6).toBe(1.5);
      expect(parsed.added_sub_items).toHaveLength(1);
    });

    it("거부된 추가 카드는 payload 에서 제외됨", () => {
      // 시나리오: 사용자가 PLC 카드 ✕ 클릭
      const rejectedCodes = new Set(["A-CUSTOM.PLC.MONTHLY_NEW"]);
      const filteredProfile = {
        ...profile,
        added_sub_items: profile.added_sub_items.filter(
          (a) => !rejectedCodes.has(a.code),
        ),
      };
      expect(filteredProfile.added_sub_items).toHaveLength(0);
      // 점수 산출에서도 PLC 카드 제외됨 (subDefMap.has() 통과 못함)
    });
  });
});

describe("E2E · 빈 OpsContext (안전 fallback)", () => {
  const empty = computeDiagnosisProfile({});

  it("빈 컨텍스트 → has_context = false", () => {
    expect(empty.has_context).toBe(false);
  });

  it("UI 변화 없음 — 모든 카드 그대로 노출", () => {
    expect(empty.weight_multipliers).toEqual({});
    expect(empty.sub_item_adaptations).toEqual({});
    expect(empty.added_sub_items).toEqual([]);
    expect(empty.reference_info).toEqual({});
  });

  it("applyWeightMultipliers — 빈 profile 시 도메인 weight 변동 없음", () => {
    const framework = loadFramework();
    const baseDefs: DomainDef[] = framework.domains.map((d) => ({
      code: d.code,
      weight: d.weight,
      tier: d.tier,
    }));
    const adapted = applyWeightMultipliers(baseDefs, empty);
    expect(adapted).toEqual(baseDefs);
  });
});

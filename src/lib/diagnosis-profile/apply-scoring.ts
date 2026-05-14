/**
 * Diagnosis Profile → Scoring 적용 어댑터.
 *
 * `aggregateRespondents` / `computeAllScores` 가 profile 을 받아 다음을 적용:
 *   1) T1 weight multipliers — domainDefs.weight × multiplier
 *   2) Inactive sub-items — 응답 없을 때 missing penalty 면제
 *   3) Added sub-items — subDefs 에 추가 (응답 시 정상 산출에 들어감)
 *
 * 모든 함수는 순수 — 원본 mutating 없음, 새 객체 반환.
 */

import type {
  DomainDef,
  SubItemDef,
} from "@/lib/scoring";
import type { FrameworkConfig, SubItem } from "@/lib/framework/loader";
import type {
  AddedSubItem,
  DiagnosisProfile,
} from "./types";

/**
 * Domain 가중치에 multiplier 적용. profile 미지정 시 원본 그대로.
 */
export function applyWeightMultipliers(
  domainDefs: DomainDef[],
  profile: DiagnosisProfile | null | undefined,
): DomainDef[] {
  if (!profile || Object.keys(profile.weight_multipliers).length === 0) {
    return domainDefs;
  }
  return domainDefs.map((d) => {
    const m = profile.weight_multipliers[d.code];
    if (m === undefined || m === 1.0) return d;
    return { ...d, weight: d.weight * m };
  });
}

/**
 * Added sub-items 를 SubItemDef[] 로 변환해 합치기.
 * 추가 카드들은 group code 가 동일 도메인 내 "{domain}.CUSTOM" 으로 합성된다.
 * 점수 산출 시 별도 group 으로 처리 (기존 group 점수에 영향 X).
 */
export function buildAddedSubDefs(
  added: AddedSubItem[],
): SubItemDef[] {
  return added.map((a) => ({
    code: a.code,
    domain: a.domain,
    group: `${a.domain}.CUSTOM`,
    tier: a.tier,
    weight_within_group: a.weight_within_group,
    data_quality_required: 1,
    reverse_scoring: false,
  }));
}

/**
 * Missing-penalty 계산 시 inactive sub-item 은 제외한다.
 * `aggregateRespondents` 의 기존 missing-penalty 룰을 대체하는 헬퍼.
 *
 * 룰: 응답 없음 + data_quality_required ≥ 2 → -8 페널티.
 * 비활성은 응답 없음을 페널티 없이 받아들임.
 */
export function computeMissingPenaltyForDomain(
  domainCode: string,
  framework: FrameworkConfig,
  respondedCodes: Set<string>,
  profile: DiagnosisProfile | null | undefined,
): number {
  const domain = framework.domains.find((d) => d.code === domainCode);
  if (!domain) return 0;
  const inactive = profile?.sub_item_adaptations ?? {};
  let count = 0;
  for (const g of domain.groups) {
    for (const s of g.sub_items) {
      if (respondedCodes.has(s.code)) continue;
      if (inactive[s.code]?.state === "inactive") continue; // 면제
      if ((s.data_quality_required ?? 1) >= 2) count++;
    }
  }
  return count * -8;
}

/**
 * Added sub-items 를 framework groups 구조에 합쳐 가짜 group 을 만듬.
 * `aggregateRespondents` 의 groupDefs 빌드 시 호출.
 *
 * 추가된 sub-item 의 group 은 `{domain}.CUSTOM` 으로 생성되고 도메인 내
 * weight_within_domain 은 기존 group 수에 +1 한 값의 역수.
 */
export function buildAddedSubItems(
  added: AddedSubItem[],
): SubItem[] {
  // 5점 척도 어디서나 같음
  return added.map(
    (a): SubItem => ({
      code: a.code,
      domain: a.domain,
      group: `${a.domain}.CUSTOM`,
      tier: a.tier,
      weight_within_group: a.weight_within_group,
      belief: {
        q: a.belief_q,
        anchors: a.belief_anchors,
        help: undefined,
      },
      evidence: {
        q: a.evidence_q,
        type: "choice",
        options: a.evidence_options.map((o) => ({ v: o.v, label: o.label })),
        refresh_period_days: 90,
      },
      citation: `회사 컨텍스트 기반 자동 추가 — ${a.added_reason}`,
      failure_trigger: "",
      cadence: "quarterly",
      data_quality_required: 1,
    }),
  );
}

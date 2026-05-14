/**
 * Diagnosis aggregate 공통 헬퍼.
 *
 * 같은 워크스페이스의 모든 응답자 응답을 sub-item 단위로 합산해
 * (overall_score, domain_scores, failure_probability, stage) 산출.
 *
 * 사용처:
 *   - /diag/[workspace]/home/page.tsx (운영 hub)
 *   - /diag/page.tsx (워크스페이스 카드 목록 — 카드 점수와 홈 점수 일치 위해)
 *   - /diag/[workspace]/result/page.tsx (상세 리포트)
 *
 * 입력: framework + diagnosis_responses rows
 * 출력: 단일 점수 + 도메인 점수 + 실패확률 + stage
 */

import {
  computeSubItemScore,
  computeGroupScore,
  computeDomainScore,
  computeOverallScore,
  computeFailureProbability,
  computeConsensus,
  buildScoringConfig,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
  type GroupDef,
  type DomainDef,
  type DomainScoreResult,
} from "@/lib/scoring";
import type { FrameworkConfig } from "@/lib/framework/loader";
import type { DiagnosisProfile } from "@/lib/diagnosis-profile/types";
import {
  applyWeightMultipliers,
  buildAddedSubDefs,
  computeMissingPenaltyForDomain,
} from "@/lib/diagnosis-profile/apply-scoring";

export interface DiagRowMin {
  respondent_num: number;
  stage: string | null;
  responses: Record<
    string,
    {
      belief: number;
      evidence: number | null;
      na?: boolean;
      evidence_recorded_at: string;
    }
  > | null;
}

export interface AggregateResult {
  overall: number | null;
  domain_scores: DomainScoreResult[];
  fp: ReturnType<typeof computeFailureProbability>;
  stage: Stage;
}

/**
 * @param surveyInjections active 설문(NPS/PMF) 가 30+ 응답 모았을 때 자동 evidence.
 *   `getActiveSurveysSummary()` 결과를 미리 fetch 해서 호출자가 전달.
 *   생략하면 진단 응답만으로 계산 (이전 동작 그대로).
 * @param profile 운영 컨텍스트 기반 진단 적응 프로필 — T1 가중치 + T3 추가 카드 +
 *   inactive 면제 적용. 생략하면 기본 frame 그대로 (이전 동작 그대로).
 */
export function aggregateRespondents(
  framework: FrameworkConfig,
  rows: DiagRowMin[],
  surveyInjections: SubItemResponse[] = [],
  profile: DiagnosisProfile | null = null,
): AggregateResult {
  // 기본 frame + T3 추가 카드를 SubItemDef 로 합성
  const baseSubDefs: SubItemDef[] = framework.domains.flatMap((d) =>
    d.groups.flatMap((g) =>
      g.sub_items.map((s) => ({
        code: s.code,
        domain: d.code,
        group: g.code,
        tier: s.tier,
        weight_within_group: s.weight_within_group,
        data_quality_required: (s.data_quality_required ?? 1) as 1 | 2 | 3,
        reverse_scoring: s.reverse_scoring,
      })),
    ),
  );
  const addedSubDefs: SubItemDef[] = profile
    ? buildAddedSubDefs(profile.added_sub_items)
    : [];
  const subDefs: SubItemDef[] = [...baseSubDefs, ...addedSubDefs];
  const subDefMap = new Map(subDefs.map((s) => [s.code, s]));

  const responses: SubItemResponse[] = [];
  for (const row of rows) {
    if (!row.responses) continue;
    for (const [code, r] of Object.entries(row.responses)) {
      if (!subDefMap.has(code)) continue;
      if (!r.belief) continue;
      responses.push({
        sub_item_code: code,
        respondent_id: `r${row.respondent_num}`,
        belief: r.belief as 1 | 2 | 3 | 4 | 5,
        evidence:
          r.na || r.evidence === null || r.evidence === undefined
            ? null
            : (r.evidence as 1 | 2 | 3 | 4 | 5),
        evidence_recorded_at: new Date(r.evidence_recorded_at),
      });
    }
  }

  // 자동 설문 결과 합산 (NPS · PMF) — 30+ 응답 모인 active 설문이 있을 때만.
  // 익명 응답자와 같은 가중치로 합산되어 consensus 평균에 들어간다.
  for (const inj of surveyInjections) {
    if (!subDefMap.has(inj.sub_item_code)) continue;
    responses.push(inj);
  }

  const now = new Date();
  const subScoresPerRespondent = new Map<
    string,
    Map<string, ReturnType<typeof computeSubItemScore>>
  >();
  for (const r of responses) {
    const def = subDefMap.get(r.sub_item_code);
    if (!def) continue;
    const score = computeSubItemScore(r, def, now);
    if (!subScoresPerRespondent.has(r.respondent_id)) {
      subScoresPerRespondent.set(r.respondent_id, new Map());
    }
    subScoresPerRespondent.get(r.respondent_id)!.set(r.sub_item_code, score);
  }

  const subScoreAvg = new Map<
    string,
    ReturnType<typeof computeSubItemScore>
  >();
  for (const def of subDefs) {
    const scores: number[] = [];
    let representativeFlag: ReturnType<typeof computeSubItemScore>["flag"];
    for (const map of subScoresPerRespondent.values()) {
      const r = map.get(def.code);
      if (!r) continue;
      if (r.score !== null) scores.push(r.score);
      if (r.flag) representativeFlag = r.flag;
    }
    if (scores.length === 0) continue;
    const consensus = computeConsensus(scores);
    subScoreAvg.set(def.code, {
      score: consensus?.reported_score ?? null,
      penalty: 0,
      flag: representativeFlag,
      belief_normalized: 0,
      evidence_normalized: null,
    });
  }

  // 추가 카드의 도메인별 group 추가 (T3)
  const addedByDomain = new Map<string, SubItemDef[]>();
  for (const a of addedSubDefs) {
    const list = addedByDomain.get(a.domain);
    if (list) list.push(a);
    else addedByDomain.set(a.domain, [a]);
  }
  const groupDefs: GroupDef[] = framework.domains.flatMap((d) => {
    const hasCustom = addedByDomain.has(d.code);
    const totalGroups = d.groups.length + (hasCustom ? 1 : 0) || 1;
    const baseGroups: GroupDef[] = d.groups.map((g) => ({
      code: g.code,
      domain: d.code,
      weight_within_domain: 1 / totalGroups,
      is_critical: g.sub_items.some((s) => s.tier === "critical"),
    }));
    if (hasCustom) {
      const cs = addedByDomain.get(d.code)!;
      baseGroups.push({
        code: `${d.code}.CUSTOM`,
        domain: d.code,
        weight_within_domain: 1 / totalGroups,
        is_critical: cs.some((s) => s.tier === "critical"),
      });
    }
    return baseGroups;
  });
  const subDefsByGroup = new Map<string, SubItemDef[]>();
  for (const s of subDefs) {
    const list = subDefsByGroup.get(s.group);
    if (list) list.push(s);
    else subDefsByGroup.set(s.group, [s]);
  }

  const groupScoreMap = new Map<
    string,
    ReturnType<typeof computeGroupScore>
  >();
  for (const [code, defs] of subDefsByGroup.entries()) {
    const groupDef = groupDefs.find((g) => g.code === code);
    if (!groupDef) continue;
    groupScoreMap.set(code, computeGroupScore(groupDef, defs, subScoreAvg));
  }

  const respondedCodes = new Set(responses.map((r) => r.sub_item_code));
  // T1 — weight multipliers 적용된 DomainDef
  const baseDomainDefs: DomainDef[] = framework.domains.map((d) => ({
    code: d.code,
    weight: d.weight,
    tier: d.tier,
  }));
  const domainDefs: DomainDef[] = applyWeightMultipliers(
    baseDomainDefs,
    profile,
  );
  const domainDefByCode = new Map(domainDefs.map((d) => [d.code, d]));
  const domain_scores = framework.domains.map((d) => {
    // 비활성 sub-item 은 missing penalty 면제
    const missingPenalty = computeMissingPenaltyForDomain(
      d.code,
      framework,
      respondedCodes,
      profile,
    );
    const def = domainDefByCode.get(d.code) ?? {
      code: d.code,
      weight: d.weight,
      tier: d.tier,
    };
    return computeDomainScore(
      def,
      groupDefs.filter((g) => g.domain === d.code),
      groupScoreMap,
      missingPenalty,
      d.thresholds,
    );
  });
  const overall = computeOverallScore(domain_scores, domainDefs);
  const stage = (rows[rows.length - 1]?.stage as Stage) ?? "open_beta";

  // YAML 의 priors·LR·critical_caps 를 ScoringConfig 로 빌드해 주입.
  // (이전엔 5번째 인자 undefined → hardcoded DEFAULT_PRIORS 사용 → YAML SoT 무시)
  const scoringConfig = buildScoringConfig(framework);
  const fp = computeFailureProbability(
    domain_scores,
    domainDefs,
    responses,
    stage,
    scoringConfig,
    {
      subDefs,
      now,
      respondentCount: rows.length,
    },
  );

  return { overall, domain_scores, fp, stage };
}

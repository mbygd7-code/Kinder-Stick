/**
 * Kinder Stick OS — Scoring Engine
 *
 * framework/scoring.md 명세를 그대로 구현한 순수 함수들.
 * 외부 의존성 없음 (TS만으로 동작) — 단위 테스트와 서버 사이드 모두에서 사용.
 *
 * 설계 원칙:
 *  - Belief–Evidence 망상 페널티
 *  - Time decay (90/180일 cutoff)
 *  - Critical sub-item / group / domain cap
 *  - Bayesian failure probability (CB Insights prior × LR)
 *  - Critical-Critical sub-item floor (특정 sub_item 단독으로 실패확률 minimum 강제)
 *  - Team consensus σ → confidence (점수 X, 신뢰도 O)
 *  - Reverse scoring (A7.PII.INCIDENT 같은 1=best 항목)
 */

// ============================================================
// Types
// ============================================================

/**
 * 제품 출시 단계 — VC 펀딩 단계가 아닌 내부 운영 관점.
 *  - closed_beta : 초청 베타, ~30명, PMF 탐색 초기
 *  - open_beta   : 공개 베타, 100~500명, PMF 검증
 *  - ga_early    : 정식 출시 직후 0–6개월
 *  - ga_growth   : 성장기 6–24개월 (채널·리텐션)
 *  - ga_scale    : 확장기 24개월+ (NRR·PLC·운영)
 */
export type Stage = "closed_beta" | "open_beta" | "ga_early" | "ga_growth" | "ga_scale";

export type Tier = "critical" | "important" | "supporting";

export interface SubItemDef {
  code: string;
  domain: string;             // "A2"
  group: string;              // "A2.SE"
  tier: Tier;
  weight_within_group: number;
  data_quality_required: 1 | 2 | 3;
  reverse_scoring?: boolean;
}

export interface GroupDef {
  code: string;               // "A2.SE"
  domain: string;             // "A2"
  weight_within_domain: number;
  is_critical: boolean;       // 도메인 내 critical 여부 — sub-item tier로도 추정 가능하나 명시
}

export interface DomainDef {
  code: string;               // "A2"
  weight: number;             // 0..100
  tier: Tier;
}

export interface SubItemResponse {
  sub_item_code: string;
  respondent_id: string;
  belief: 1 | 2 | 3 | 4 | 5;
  evidence: 1 | 2 | 3 | 4 | 5 | null;
  evidence_recorded_at: Date;
}

export interface CriticalCap {
  sub_item: string;
  /** Function evaluating whether this cap should fire for the given input.
   *  Returns true to apply min_p_6m floor. */
  predicate: (ctx: CapContext) => boolean;
  min_p_6m: number;           // 0..1
}

export interface CapContext {
  responses: Map<string, SubItemResponse[]>;  // sub_item_code → responses
  stage: Stage;
}

export interface ScoringConfig {
  priors: Record<Stage, { failure_6m: number; failure_12m: number }>;
  likelihood_ratios: Record<string, number>;  // domain_code → LR (red critical)
  critical_caps: CriticalCap[];
}

// ============================================================
// Defaults from question_bank.yaml (Bayesian priors + LRs)
// ============================================================

/**
 * 제품 출시 단계별 baseline 실패 확률.
 *
 * 캘리브레이션 출처:
 *  - CB Insights "The Top 12 Reasons Startups Fail" N=431 — early-stage 4년 누적 ~75% 폐업
 *  - Statistic Brain Research "Startup Business Failure Rate by Industry" — 1년차 21%, 2년차 30%
 *  - 한국 영유아 EdTech 베타~정식 출시 cohort 관찰: 베타 cohort 12개월 내 50%+ 가 폐업·피벗·해체
 *  - Korean Startup Association 2024: 영유아 SaaS 1년 실패율 ~35%
 *
 * 이 수치는 "아무 진단 정보 없이 단계만으로 가정한 baseline" — 진단 결과(점수·데이터 품질)가
 * LR로 곱해져 보정됨. 좋은 진단 결과는 prior에서 끌어내림, 나쁜 진단은 끌어올림.
 */
export const DEFAULT_PRIORS: ScoringConfig["priors"] = {
  closed_beta: { failure_6m: 0.45, failure_12m: 0.65 }, // PMF 미검증, 가장 위험
  open_beta:   { failure_6m: 0.35, failure_12m: 0.55 }, // 베타 검증 중
  ga_early:    { failure_6m: 0.22, failure_12m: 0.40 }, // 정식 출시 0–6mo
  ga_growth:   { failure_6m: 0.13, failure_12m: 0.25 }, // 성장기
  ga_scale:    { failure_6m: 0.07, failure_12m: 0.16 }, // 확립 사업
};

/**
 * 도메인별 likelihood ratio — red critical 상태 시 베이지안 odds 배수.
 * A12(자금·런웨이·IR) 와 A5(자금성 단위경제) 는 본 서비스 범위 밖이라 제거됨.
 * (교사 결정자 중심 EdTech 운영 진단 — 운영진의 일상 의사결정에 직접 영향만 포함)
 */
export const DEFAULT_LIKELIHOOD_RATIOS: Record<string, number> = {
  A2:  3.5, // PMF
  A7:  3.0, // 신뢰·안전·규제 (KISA, 개인정보)
  A11: 2.6, // 팀·리더십·문화
  A1:  2.0, // 시장-문제 적합성
  A3:  1.8, // 결정자(교사) ROI
  A4:  1.7, // 사용자(교사) 활성화·유지
};

// 12m cap = 6m cap × 1.6 (scoring.md heuristic)
const HORIZON_12M_MULT = 1.6;

// ============================================================
// 0b. ScoringConfig builder — YAML → runtime config
// ============================================================

/**
 * YAML 의 critical_caps 원시 형식.
 * condition 은 small DSL 문자열 (`evidence.v <= 2 AND stage IN [open_beta, ga_early]` 등).
 */
export interface CriticalCapRawInput {
  sub_item: string;
  condition: string;
  min_p_6m: number;
}

/**
 * YAML framework 에서 ScoringConfig 를 빌드한다.
 *
 * 사용 이유: `question_bank.yaml` 이 priors·LR·critical_caps 의 SoT (Single source of truth)
 * 이지만 이전 코드는 모두 `computeFailureProbability(..., config: undefined, ...)` 로 호출해
 * hardcoded DEFAULT_PRIORS 만 사용했음 (Appendix H-1.1, H-1.2). 이 helper 로 YAML 값이
 * 진단 실제 계산에 흘러들어가게 된다.
 */
export function buildScoringConfig(framework: {
  priors?: Record<Stage, { failure_6m: number; failure_12m: number }>;
  likelihood_ratios?: Record<string, number>;
  critical_caps?: CriticalCapRawInput[];
}): ScoringConfig {
  return {
    priors: framework.priors ?? DEFAULT_PRIORS,
    likelihood_ratios:
      framework.likelihood_ratios ?? DEFAULT_LIKELIHOOD_RATIOS,
    critical_caps: (framework.critical_caps ?? []).map(compileCriticalCap),
  };
}

/**
 * condition 문자열 → predicate 함수 컴파일.
 *
 * 지원 문법 (AND 으로 결합):
 *   - `evidence.v <op> <n>`   (op: == != < <= > >=)
 *   - `stage IN [a, b, c]`     (stage 이름 콤마 구분)
 *   - `has_<flag>`             (시스템에 flag 가 없으면 false 로 평가 — 보수적)
 *
 * 모든 알 수 없는 절은 false 로 평가해 cap 이 잘못 발동하지 않게 한다 (fail-safe).
 * 결과 predicate: 해당 sub_item 에 응답한 응답자 중 *어느 한 명이라도* 조건을
 * 만족하면 true. PII 사고 같은 cap 은 "한 명만 보고해도 발동" 의미.
 */
export function compileCriticalCap(raw: CriticalCapRawInput): CriticalCap {
  const clauses = raw.condition.split(/\s+AND\s+/i).map((c) => c.trim());
  type Clause = (ctx: CapContext) => boolean;
  const compiled: Clause[] = [];

  for (const clause of clauses) {
    // evidence.v <op> N
    const mEv = clause.match(/^evidence\.v\s*(==|!=|<=|>=|<|>)\s*(\d+)$/);
    if (mEv) {
      const op = mEv[1];
      const n = parseInt(mEv[2], 10);
      compiled.push((ctx) => {
        const rs = ctx.responses.get(raw.sub_item) ?? [];
        for (const r of rs) {
          if (r.evidence === null) continue;
          const v = r.evidence;
          let ok = false;
          switch (op) {
            case "==": ok = v === n; break;
            case "!=": ok = v !== n; break;
            case "<":  ok = v < n; break;
            case "<=": ok = v <= n; break;
            case ">":  ok = v > n; break;
            case ">=": ok = v >= n; break;
          }
          if (ok) return true;
        }
        return false;
      });
      continue;
    }

    // stage IN [a, b, c]
    const mStage = clause.match(/^stage\s+IN\s+\[(.+)\]$/i);
    if (mStage) {
      const stages = mStage[1].split(",").map((s) => s.trim());
      compiled.push((ctx) => stages.includes(ctx.stage));
      continue;
    }

    // bare flag (예: has_active_competitive_deals) — 시스템에 미추적이라 false
    if (/^has_[a-z_]+$/i.test(clause)) {
      compiled.push(() => false);
      continue;
    }

    // 알 수 없는 절 — fail-safe false
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[scoring] Unknown critical-cap clause for ${raw.sub_item}: "${clause}"`,
      );
    }
    compiled.push(() => false);
  }

  return {
    sub_item: raw.sub_item,
    predicate: (ctx) => compiled.every((c) => c(ctx)),
    min_p_6m: raw.min_p_6m,
  };
}

// ============================================================
// 1. Sub-item score (0..100)
// ============================================================

export interface SubItemScoreResult {
  score: number | null;       // null if missing evidence + dq_req >= 2
  penalty: number;             // domain-level penalty if score is null
  flag?: "stale" | "stale_required";
  belief_normalized: number;
  evidence_normalized: number | null;
}

export function computeSubItemScore(
  response: SubItemResponse,
  def: SubItemDef,
  now: Date = new Date(),
): SubItemScoreResult {
  // Belief 0..100
  const B = ((response.belief - 1) / 4) * 100;

  // Evidence 0..100 with reverse scoring support
  let E: number | null;
  if (response.evidence === null) {
    E = null;
  } else if (def.reverse_scoring) {
    // 1=best, 5=worst → flip
    E = ((5 - response.evidence) / 4) * 100;
  } else {
    E = ((response.evidence - 1) / 4) * 100;
  }

  // Missing evidence handling
  if (E === null) {
    if (def.data_quality_required >= 2) {
      return {
        score: null,
        penalty: -8,
        belief_normalized: B,
        evidence_normalized: null,
      };
    }
    // dq_req == 1: belief solo with confidence multiplier
    E = 0.7 * B;
  }

  // Combine (35% belief + 65% evidence)
  let raw = 0.35 * B + 0.65 * E;

  // Belief–Evidence delusion penalty
  const gap = B - E;
  if (gap > 25) {
    raw -= Math.min(15, (gap - 25) * 0.5);
  }

  // Time decay
  const days = daysBetween(now, response.evidence_recorded_at);
  let decay = 1.0;
  let flag: SubItemScoreResult["flag"];
  if (days <= 90) {
    decay = 1.0;
  } else if (days <= 180) {
    decay = 1.0 - ((days - 90) / 90) * 0.20;
    flag = "stale";
  } else {
    decay = 0.5;
    flag = "stale_required";
  }

  const score = clamp(raw * decay, 0, 100);

  return {
    score,
    penalty: 0,
    flag,
    belief_normalized: B,
    evidence_normalized: E,
  };
}

// ============================================================
// 2. Group score (0..100) with Critical cap
// ============================================================

export interface GroupScoreResult {
  group: string;
  score: number | null;
  capped: boolean;             // true if critical sub-item < 40 forced cap
  n_subs: number;
  n_missing: number;
}

export function computeGroupScore(
  groupDef: GroupDef,
  subDefs: SubItemDef[],
  subScores: Map<string, SubItemScoreResult>,
): GroupScoreResult {
  const items: { score: number; weight: number; tier: Tier }[] = [];
  let n_missing = 0;

  for (const sub of subDefs) {
    const s = subScores.get(sub.code);
    if (!s || s.score === null) {
      n_missing++;
      continue;
    }
    items.push({
      score: s.score,
      weight: sub.weight_within_group,
      tier: sub.tier,
    });
  }

  if (items.length === 0) {
    return {
      group: groupDef.code,
      score: null,
      capped: false,
      n_subs: subDefs.length,
      n_missing,
    };
  }

  const G_raw = weightedMean(items.map((i) => [i.score, i.weight]));

  // Critical cap: any critical sub-item < 40 forces group cap
  const criticalRedExists = items.some(
    (i) => i.tier === "critical" && i.score < 40,
  );

  const G = criticalRedExists ? Math.min(G_raw, 45) : G_raw;

  return {
    group: groupDef.code,
    score: G,
    capped: criticalRedExists,
    n_subs: subDefs.length,
    n_missing,
  };
}

// ============================================================
// 3. Domain score (0..100) with Critical cap + missing penalty
// ============================================================

export interface DomainScoreResult {
  domain: string;
  score: number | null;
  capped: boolean;
  missing_penalty: number;     // sum of -8 per missing-with-dq>=2
  tier_label: "red" | "yellow" | "green";
}

export function computeDomainScore(
  domainDef: DomainDef,
  groupDefs: GroupDef[],
  groupScores: Map<string, GroupScoreResult>,
  missingPenalty: number,
  thresholds: { red: number; yellow: number; green: number },
): DomainScoreResult {
  const items: { score: number; weight: number; isCritical: boolean }[] = [];

  for (const g of groupDefs) {
    const gs = groupScores.get(g.code);
    if (!gs || gs.score === null) continue;
    items.push({
      score: gs.score,
      weight: g.weight_within_domain,
      isCritical: g.is_critical,
    });
  }

  if (items.length === 0) {
    return {
      domain: domainDef.code,
      score: null,
      capped: false,
      missing_penalty: missingPenalty,
      tier_label: "red",
    };
  }

  const D_raw = weightedMean(items.map((i) => [i.score, i.weight]));
  const D_after_penalty = Math.max(0, D_raw + missingPenalty);

  const criticalRedExists = items.some(
    (i) => i.isCritical && i.score < 40,
  );

  const D = criticalRedExists
    ? Math.min(D_after_penalty, 50)
    : D_after_penalty;

  let tier_label: "red" | "yellow" | "green" = "red";
  if (D >= thresholds.green) tier_label = "green";
  else if (D >= thresholds.yellow) tier_label = "yellow";
  else if (D >= thresholds.red) tier_label = "yellow";  // red threshold is the floor of yellow
  else tier_label = "red";

  return {
    domain: domainDef.code,
    score: D,
    capped: criticalRedExists,
    missing_penalty: missingPenalty,
    tier_label,
  };
}

// ============================================================
// 4. Team consensus (per sub-item)
// ============================================================

export interface ConsensusResult {
  reported_score: number;
  sigma: number;
  confidence: 1.0 | 0.85 | 0.65 | 0.4;
  ci_95: [number, number] | null;
  needs_discussion: boolean;
  n: number;
}

export function computeConsensus(
  scores: number[],   // per-respondent sub-item scores (0..100), nulls excluded
): ConsensusResult | null {
  const n = scores.length;
  if (n === 0) return null;

  const mu = mean(scores);
  const sigma = n >= 2 ? stdev(scores, mu) : 0;

  let confidence: ConsensusResult["confidence"];
  if (sigma <= 12) confidence = 1.0;
  else if (sigma <= 18) confidence = 0.85;
  else if (sigma <= 25) confidence = 0.65;
  else confidence = 0.4;

  let ci_95: [number, number] | null = null;
  if (n >= 3) {
    const margin = 1.96 * (sigma / Math.sqrt(n));
    ci_95 = [Math.max(0, mu - margin), Math.min(100, mu + margin)];
  }

  return {
    reported_score: mu,
    sigma,
    confidence,
    ci_95,
    needs_discussion: sigma > 18,
    n,
  };
}

// ============================================================
// 5. Overall score (weighted by domain.weight, 합 = 100)
// ============================================================

export function computeOverallScore(
  domains: DomainScoreResult[],
  domainDefs: DomainDef[],
): number | null {
  const items: [number, number][] = [];
  const defMap = new Map(domainDefs.map((d) => [d.code, d]));
  for (const d of domains) {
    if (d.score === null) continue;
    const def = defMap.get(d.domain);
    if (!def) continue;
    items.push([d.score, def.weight]);
  }
  if (items.length === 0) return null;
  return weightedMean(items);
}

// ============================================================
// 6. Failure probability (Bayesian)
// ============================================================

export interface DomainLRContribution {
  domain: string;            // "A2"
  score: number;             // 0..100
  band: "red" | "amber" | "neutral" | "green" | "excellent";
  multiplier: number;        // 적용된 곱셈 (>1 = 악화, <1 = 개선, 1.0 = 중립)
}

export interface FactorContribution {
  factor:
    | "critical_health"
    | "important_health"
    | "data_quality"
    | "data_freshness"
    | "respondent_count"
    | "delusion_gap"
    | "missing_critical_evidence"
    | "consensus_disagreement";
  label: string;          // 한국어 라벨
  log_lr: number;         // log-LR 기여도 (양수 = 위험↑, 음수 = 위험↓)
  detail: string;         // 한 줄 설명
}

export interface FailureProbabilityResult {
  prior: number;
  posterior: number;
  cap_floor: number;
  final: number;
  red_critical_domains: string[];      // 호환성: band==="red"인 도메인만
  triggered_caps: string[];
  /**
   * 도메인별 critical 점수와 band — UI 설명용.
   * multiplier 는 가중치 평균에 차지하는 비율(0..1).
   */
  domain_contributions: DomainLRContribution[];
  /**
   * 다요인 log-LR 분해 — "왜 이 숫자가 나왔나" 의 상세.
   */
  factor_contributions: FactorContribution[];
  ci_95?: [number, number] | null;
}

export interface FailureProbabilityHorizons {
  "6m": FailureProbabilityResult;
  "12m": FailureProbabilityResult;
}

export interface FailureProbabilityOptions {
  /** Sub-item definitions — critical/important missing evidence 카운트용 */
  subDefs?: SubItemDef[];
  /** 현재 시각 — time decay 계산용 (기본: new Date()) */
  now?: Date;
  /** 응답자 수 — 저표본 페널티용 (기본: responses 에서 unique respondent_id 카운트) */
  respondentCount?: number;
}

export function computeFailureProbability(
  domains: DomainScoreResult[],
  domainDefs: DomainDef[],
  responses: SubItemResponse[],
  stage: Stage,
  config: ScoringConfig = {
    priors: DEFAULT_PRIORS,
    likelihood_ratios: DEFAULT_LIKELIHOOD_RATIOS,
    critical_caps: [],   // 호출자가 question_bank.yaml에서 빌드해서 주입
  },
  options: FailureProbabilityOptions = {},
): FailureProbabilityHorizons {
  const defMap = new Map(domainDefs.map((d) => [d.code, d]));
  const responsesByCode = groupBy(responses, (r) => r.sub_item_code);
  const now = options.now ?? new Date();
  const respondentCount =
    options.respondentCount ??
    new Set(responses.map((r) => r.respondent_id)).size;
  const subDefMap = new Map(
    (options.subDefs ?? []).map((s) => [s.code, s]),
  );

  /**
   * Multi-Factor log-LR 모델.
   *
   * 단순 "도메인 점수 → 단일 LR" 한계를 넘어 8개 신호를 log-LR로 합산해 posterior 산출.
   * 모든 요인은 독립 가정 (log-additive). 캘리브레이션은 한국 영유아 EdTech 베타~정식
   * cohort + CB Insights N=431.
   *
   * 요인 1: Critical 도메인 가중 health (Sec 6.1)
   * 요인 2: Important 도메인 가중 health (half weight)
   * 요인 3: 데이터 품질 — 자가평가만 vs 실측 KPI 비율
   * 요인 4: 데이터 신선도 — 평균 응답 경과일
   * 요인 5: 응답자 수 — 저표본 페널티
   * 요인 6: Belief–Evidence delusion gap 비율
   * 요인 7: Missing critical evidence 결측률
   * 요인 8: 응답자 합의도 (σ) — 이견 큼 페널티
   */

  const SCORE_BANDS = [
    { max: 40,  band: "red"       as const, log_lr: +1.39 }, // exp(1.39) ≈ 4.0
    { max: 60,  band: "amber"     as const, log_lr: +0.34 }, // exp(0.34) ≈ 1.4
    { max: 75,  band: "neutral"   as const, log_lr:  0.00 },
    { max: 85,  band: "green"     as const, log_lr: -0.36 }, // exp(-0.36) ≈ 0.7
    { max: 101, band: "excellent" as const, log_lr: -0.92 }, // exp(-0.92) ≈ 0.4
  ];

  const factor_contributions: FactorContribution[] = [];

  // ── 요인 1: Critical 도메인 가중 health ──
  let critNum = 0;
  let critDen = 0;
  const contributions: DomainLRContribution[] = [];
  for (const d of domains) {
    const def = defMap.get(d.domain);
    if (!def || def.tier !== "critical") continue;
    if (d.score === null) continue;
    const baseLR = config.likelihood_ratios[d.domain];
    if (!baseLR) continue;
    const band = SCORE_BANDS.find((b) => d.score! < b.max) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
    critNum += d.score * baseLR;
    critDen += baseLR;
    contributions.push({
      domain: d.domain,
      score: d.score,
      band: band.band,
      multiplier: baseLR, // 후처리에서 정규화
    });
  }
  const critHealth = critDen > 0 ? critNum / critDen : null;
  let critBand: DomainLRContribution["band"] = "neutral";
  if (critHealth !== null) {
    critBand = (SCORE_BANDS.find((b) => critHealth < b.max)?.band ?? "neutral");
    const bandDef = SCORE_BANDS.find((b) => b.band === critBand)!;
    factor_contributions.push({
      factor: "critical_health",
      label: "Critical 도메인 평균",
      log_lr: bandDef.log_lr,
      detail: `평균 ${critHealth.toFixed(0)}점 (${bandToKo(critBand)})`,
    });
  }
  for (const c of contributions) {
    c.multiplier = critDen > 0 ? c.multiplier / critDen : 0;
  }
  const red_critical = contributions.filter((c) => c.band === "red").map((c) => c.domain);

  // ── 요인 2: Important 도메인 가중 health (half weight) ──
  let impNum = 0;
  let impDen = 0;
  for (const d of domains) {
    const def = defMap.get(d.domain);
    if (!def || def.tier !== "important") continue;
    if (d.score === null) continue;
    const weight = 1.0; // important 도메인 균등 가중
    impNum += d.score * weight;
    impDen += weight;
  }
  const impHealth = impDen > 0 ? impNum / impDen : null;
  if (impHealth !== null) {
    const impBand = SCORE_BANDS.find((b) => impHealth < b.max)?.band ?? "neutral";
    const fullLogLR = SCORE_BANDS.find((b) => b.band === impBand)!.log_lr;
    factor_contributions.push({
      factor: "important_health",
      label: "Important 도메인 평균",
      log_lr: fullLogLR * 0.5, // half weight
      detail: `평균 ${impHealth.toFixed(0)}점 (${bandToKo(impBand)}) · half weight`,
    });
  }

  // ── 요인 3: 데이터 품질 (자가평가 vs 실측 KPI) ──
  // evidence 가 NA(=null) 비율이 높으면 데이터 부족 = 위험 신호
  const responsesWithEvidence = responses.filter((r) => r.evidence !== null);
  const evidenceRate = responses.length > 0 ? responsesWithEvidence.length / responses.length : 0;
  let dqLogLR = 0;
  let dqDetail = "";
  if (responses.length === 0) {
    dqLogLR = 0;
    dqDetail = "응답 없음";
  } else if (evidenceRate < 0.3) {
    dqLogLR = +0.45;
    dqDetail = `evidence 응답 ${(evidenceRate * 100).toFixed(0)}% — 자가평가 위주, 실측 거의 없음`;
  } else if (evidenceRate < 0.6) {
    dqLogLR = +0.20;
    dqDetail = `evidence 응답 ${(evidenceRate * 100).toFixed(0)}% — 데이터 일부만 실측`;
  } else if (evidenceRate < 0.85) {
    dqLogLR = 0;
    dqDetail = `evidence 응답 ${(evidenceRate * 100).toFixed(0)}% — 보통`;
  } else {
    dqLogLR = -0.15;
    dqDetail = `evidence 응답 ${(evidenceRate * 100).toFixed(0)}% — 실측 데이터 충분`;
  }
  factor_contributions.push({
    factor: "data_quality",
    label: "데이터 품질 (실측 비율)",
    log_lr: dqLogLR,
    detail: dqDetail,
  });

  // ── 요인 4: 데이터 신선도 ──
  let avgAge = 0;
  if (responses.length > 0) {
    const totalDays = responses.reduce(
      (acc, r) => acc + daysBetween(now, r.evidence_recorded_at),
      0,
    );
    avgAge = totalDays / responses.length;
  }
  let freshLogLR = 0;
  let freshDetail = "";
  if (responses.length === 0) {
    freshDetail = "응답 없음";
  } else if (avgAge <= 30) {
    freshLogLR = -0.10;
    freshDetail = `평균 ${avgAge.toFixed(0)}일 — 신선`;
  } else if (avgAge <= 90) {
    freshLogLR = 0;
    freshDetail = `평균 ${avgAge.toFixed(0)}일 — 보통`;
  } else if (avgAge <= 180) {
    freshLogLR = +0.25;
    freshDetail = `평균 ${avgAge.toFixed(0)}일 — 노후 (90일 초과)`;
  } else {
    freshLogLR = +0.55;
    freshDetail = `평균 ${avgAge.toFixed(0)}일 — 매우 노후 (180일 초과, stale)`;
  }
  factor_contributions.push({
    factor: "data_freshness",
    label: "응답 신선도",
    log_lr: freshLogLR,
    detail: freshDetail,
  });

  // ── 요인 5: 응답자 수 ──
  let nLogLR = 0;
  let nDetail = "";
  if (respondentCount === 0) {
    nLogLR = +0.50;
    nDetail = "응답자 0명";
  } else if (respondentCount === 1) {
    nLogLR = +0.40;
    nDetail = "응답자 1명 — 한 사람 시각만";
  } else if (respondentCount < 3) {
    nLogLR = +0.30;
    nDetail = `응답자 ${respondentCount}명 — 매우 적음`;
  } else if (respondentCount < 5) {
    nLogLR = +0.15;
    nDetail = `응답자 ${respondentCount}명 — 적음`;
  } else if (respondentCount < 7) {
    nLogLR = 0;
    nDetail = `응답자 ${respondentCount}명 — 보통`;
  } else {
    nLogLR = -0.10;
    nDetail = `응답자 ${respondentCount}명 — 충분`;
  }
  factor_contributions.push({
    factor: "respondent_count",
    label: "응답자 수",
    log_lr: nLogLR,
    detail: nDetail,
  });

  // ── 요인 6: Belief–Evidence delusion gap ──
  // belief 가 evidence 보다 25점 이상 높은 sub_item 비율
  let delusionCount = 0;
  for (const r of responses) {
    if (r.evidence === null) continue;
    const B = ((r.belief - 1) / 4) * 100;
    const E = ((r.evidence - 1) / 4) * 100;
    if (B - E > 25) delusionCount += 1;
  }
  const delusionRate = responsesWithEvidence.length > 0
    ? delusionCount / responsesWithEvidence.length
    : 0;
  let delLogLR = 0;
  let delDetail = "";
  if (responsesWithEvidence.length === 0) {
    delDetail = "evidence 응답 없음 — 평가 불가";
  } else if (delusionRate >= 0.3) {
    delLogLR = +0.40;
    delDetail = `${(delusionRate * 100).toFixed(0)}% 의 응답에서 자가 평가가 실측보다 과대 — 위험`;
  } else if (delusionRate >= 0.15) {
    delLogLR = +0.20;
    delDetail = `${(delusionRate * 100).toFixed(0)}% 에서 belief–evidence 격차`;
  } else if (delusionRate >= 0.05) {
    delLogLR = +0.05;
    delDetail = `${(delusionRate * 100).toFixed(0)}% — 소수 격차`;
  } else {
    delLogLR = 0;
    delDetail = "belief 와 evidence 일치도 높음";
  }
  factor_contributions.push({
    factor: "delusion_gap",
    label: "Belief–Evidence 격차",
    log_lr: delLogLR,
    detail: delDetail,
  });

  // ── 요인 7: Missing critical evidence ──
  // critical sub_item 중 evidence 응답이 결측인 비율
  let critTotal = 0;
  let critMissing = 0;
  for (const [code, def] of subDefMap) {
    if (def.tier !== "critical") continue;
    critTotal += 1;
    const rs = responsesByCode.get(code) ?? [];
    const hasEvidence = rs.some((r) => r.evidence !== null);
    if (!hasEvidence) critMissing += 1;
  }
  const critMissRate = critTotal > 0 ? critMissing / critTotal : 0;
  let missLogLR = 0;
  let missDetail = "";
  if (critTotal === 0) {
    missDetail = "critical 정의 미로드";
  } else if (critMissRate >= 0.5) {
    missLogLR = +0.45;
    missDetail = `critical sub-item ${critMissing}/${critTotal} (${(critMissRate * 100).toFixed(0)}%) 에 evidence 없음`;
  } else if (critMissRate >= 0.25) {
    missLogLR = +0.20;
    missDetail = `critical sub-item 결측률 ${(critMissRate * 100).toFixed(0)}%`;
  } else {
    missLogLR = 0;
    missDetail = `critical sub-item 대부분 응답 (결측 ${(critMissRate * 100).toFixed(0)}%)`;
  }
  factor_contributions.push({
    factor: "missing_critical_evidence",
    label: "Critical evidence 결측",
    log_lr: missLogLR,
    detail: missDetail,
  });

  // ── 요인 8: 응답자 합의도 (σ) ──
  // 응답자별 sub_item belief 의 평균 σ — 이견 큼이면 신뢰 떨어짐
  const sigmas: number[] = [];
  for (const [, rs] of responsesByCode) {
    if (rs.length < 2) continue;
    const beliefs = rs.map((r) => ((r.belief - 1) / 4) * 100);
    const mean = beliefs.reduce((a, b) => a + b, 0) / beliefs.length;
    const variance = beliefs.reduce((acc, b) => acc + (b - mean) ** 2, 0) / beliefs.length;
    sigmas.push(Math.sqrt(variance));
  }
  const avgSigma = sigmas.length > 0 ? sigmas.reduce((a, b) => a + b, 0) / sigmas.length : 0;
  let sigmaLogLR = 0;
  let sigmaDetail = "";
  if (sigmas.length === 0) {
    sigmaDetail = "단일 응답자 — 합의도 평가 불가";
  } else if (avgSigma > 25) {
    sigmaLogLR = +0.20;
    sigmaDetail = `σ ${avgSigma.toFixed(0)} — 응답자 간 이견 큼`;
  } else if (avgSigma > 15) {
    sigmaLogLR = +0.05;
    sigmaDetail = `σ ${avgSigma.toFixed(0)} — 일부 이견`;
  } else {
    sigmaLogLR = -0.05;
    sigmaDetail = `σ ${avgSigma.toFixed(0)} — 합의도 높음`;
  }
  factor_contributions.push({
    factor: "consensus_disagreement",
    label: "응답자 합의도",
    log_lr: sigmaLogLR,
    detail: sigmaDetail,
  });

  // ── log-LR 합산 + cap ──
  const totalLogLR = factor_contributions.reduce((acc, f) => acc + f.log_lr, 0);
  // 폭주 방지: posterior odds 가 prior 의 15배 또는 1/15배 를 넘지 않도록
  const cappedLogLR = clamp(totalLogLR, Math.log(1 / 15), Math.log(15));
  const total_LR = Math.exp(cappedLogLR);

  const ctx: CapContext = {
    responses: responsesByCode,
    stage,
  };

  const triggered_caps: string[] = [];
  let cap_floor_6m = 0;
  for (const cap of config.critical_caps) {
    if (cap.predicate(ctx)) {
      triggered_caps.push(cap.sub_item);
      cap_floor_6m = Math.max(cap_floor_6m, cap.min_p_6m);
    }
  }

  const compute = (horizon: "6m" | "12m"): FailureProbabilityResult => {
    // Defensive: DB 에 레거시 stage 값(예: "seed")이 남아있어도 안전하게 fallback.
    const stagePriors =
      config.priors[stage] ??
      config.priors.open_beta ??
      { failure_6m: 0.35, failure_12m: 0.55 };
    const prior =
      horizon === "6m" ? stagePriors.failure_6m : stagePriors.failure_12m;
    const prior_odds = prior / (1 - prior);

    const posterior_odds = prior_odds * total_LR;
    let posterior = posterior_odds / (1 + posterior_odds);
    posterior = clamp(posterior, 0.02, 0.95);

    const cap_floor = horizon === "6m" ? cap_floor_6m : cap_floor_6m * HORIZON_12M_MULT;
    const final = clamp(Math.max(posterior, cap_floor), 0.02, 0.95);

    return {
      prior,
      posterior,
      cap_floor,
      final,
      red_critical_domains: red_critical,
      triggered_caps,
      domain_contributions: contributions,
      factor_contributions,
    };
  };

  return {
    "6m": compute("6m"),
    "12m": compute("12m"),
  };
}

function bandToKo(band: DomainLRContribution["band"]): string {
  return {
    red: "위험",
    amber: "주의",
    neutral: "중립",
    green: "양호",
    excellent: "우수",
  }[band];
}

// ============================================================
// Helpers
// ============================================================

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdev(xs: number[], mu?: number): number {
  if (xs.length < 2) return 0;
  const m = mu ?? mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function weightedMean(items: [number, number][]): number {
  const totalW = items.reduce((s, [, w]) => s + w, 0);
  if (totalW === 0) return NaN;
  return items.reduce((s, [v, w]) => s + v * w, 0) / totalW;
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

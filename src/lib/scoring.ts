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
 *  - Critical-Critical sub-item floor (런웨이 < 6 → 50% 등)
 *  - Team consensus σ → confidence (점수 X, 신뢰도 O)
 *  - Reverse scoring (A7.PII.INCIDENT 같은 1=best 항목)
 */

// ============================================================
// Types
// ============================================================

export type Stage = "pre_seed" | "seed" | "series_a" | "series_b" | "series_c_plus";

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

export const DEFAULT_PRIORS: ScoringConfig["priors"] = {
  pre_seed:        { failure_6m: 0.25, failure_12m: 0.45 },
  seed:            { failure_6m: 0.18, failure_12m: 0.32 },
  series_a:        { failure_6m: 0.10, failure_12m: 0.20 },
  series_b:        { failure_6m: 0.05, failure_12m: 0.12 },
  series_c_plus:   { failure_6m: 0.03, failure_12m: 0.08 },
};

export const DEFAULT_LIKELIHOOD_RATIOS: Record<string, number> = {
  A12: 4.2, A2:  3.5, A7:  3.0, A11: 2.6,
  A5:  2.4, A1:  2.0, A3:  1.8, A4:  1.7,
};

// 12m cap = 6m cap × 1.6 (scoring.md heuristic)
const HORIZON_12M_MULT = 1.6;

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

export interface FailureProbabilityResult {
  prior: number;
  posterior: number;
  cap_floor: number;
  final: number;
  red_critical_domains: string[];
  triggered_caps: string[];
  ci_95?: [number, number] | null;
}

export interface FailureProbabilityHorizons {
  "6m": FailureProbabilityResult;
  "12m": FailureProbabilityResult;
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
): FailureProbabilityHorizons {
  const defMap = new Map(domainDefs.map((d) => [d.code, d]));
  const responsesByCode = groupBy(responses, (r) => r.sub_item_code);

  const red_critical = domains
    .filter((d) => {
      const def = defMap.get(d.domain);
      return def?.tier === "critical" && d.score !== null && d.score < 40;
    })
    .map((d) => d.domain);

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
    const prior =
      horizon === "6m"
        ? config.priors[stage].failure_6m
        : config.priors[stage].failure_12m;
    const prior_odds = prior / (1 - prior);

    let LR_product = 1.0;
    for (const code of red_critical) {
      LR_product *= config.likelihood_ratios[code] ?? 1.0;
    }

    const posterior_odds = prior_odds * LR_product;
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
    };
  };

  return {
    "6m": compute("6m"),
    "12m": compute("12m"),
  };
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

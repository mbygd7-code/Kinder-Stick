/**
 * scoring.md §단위 테스트 시드 — 9개 케이스
 * 각 테스트는 입력과 기대값을 갖고, run() 시 패스/실패를 반환한다.
 */

import {
  computeSubItemScore,
  computeConsensus,
  computeFailureProbability,
  type SubItemDef,
  type SubItemResponse,
  type DomainScoreResult,
  type DomainDef,
  type Stage,
  DEFAULT_PRIORS,
  DEFAULT_LIKELIHOOD_RATIOS,
} from "./scoring";

export interface TestResult {
  id: string;
  name: string;
  category: "sub_item" | "consensus" | "failure_prob";
  pass: boolean;
  expected: string;
  actual: string;
  detail?: string;
}

const NOW = new Date("2026-05-07T00:00:00Z");

function daysAgo(d: number): Date {
  return new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
}

const baseDef = (overrides: Partial<SubItemDef> = {}): SubItemDef => ({
  code: "TEST.X",
  domain: "A2",
  group: "A2.X",
  tier: "critical",
  weight_within_group: 1,
  data_quality_required: 2,
  ...overrides,
});

const baseResp = (overrides: Partial<SubItemResponse> = {}): SubItemResponse => ({
  sub_item_code: "TEST.X",
  respondent_id: "r1",
  belief: 5,
  evidence: 5,
  evidence_recorded_at: daysAgo(30),
  ...overrides,
});

function close(a: number, b: number, tol = 0.5): boolean {
  return Math.abs(a - b) <= tol;
}

export function runScoringTests(): TestResult[] {
  const out: TestResult[] = [];

  // ---- T1: perfect 5/5 → 100 ----
  {
    const r = computeSubItemScore(baseResp(), baseDef(), NOW);
    out.push({
      id: "T1",
      name: "Perfect 5/5",
      category: "sub_item",
      pass: r.score === 100,
      expected: "100",
      actual: String(r.score),
    });
  }

  // ---- T2: B=5 E=1 → delusion penalty applied ----
  // B=100, E=0, raw=35, gap=100, raw -= min(15, (100-25)*0.5)=15 → raw=20, decay=1 → 20
  {
    const r = computeSubItemScore(baseResp({ evidence: 1 }), baseDef(), NOW);
    out.push({
      id: "T2",
      name: "Delusion (B=5, E=1) → 20",
      category: "sub_item",
      pass: r.score !== null && close(r.score, 20),
      expected: "≈ 20",
      actual: r.score?.toFixed(2) ?? "null",
    });
  }

  // ---- T3: B=1 E=5 → high evidence overrides low belief ----
  // B=0, E=100, raw=65, gap=-100 (no penalty) → 65
  {
    const r = computeSubItemScore(baseResp({ belief: 1, evidence: 5 }), baseDef(), NOW);
    out.push({
      id: "T3",
      name: "Underconfident (B=1, E=5) → 65",
      category: "sub_item",
      pass: r.score !== null && close(r.score, 65),
      expected: "≈ 65",
      actual: r.score?.toFixed(2) ?? "null",
    });
  }

  // ---- T4: stale evidence (200d) ----
  // B=4=75, E=4=75, raw=75, gap=0, decay=0.5 → 37.5, flag=stale_required
  {
    const r = computeSubItemScore(
      baseResp({ belief: 4, evidence: 4, evidence_recorded_at: daysAgo(200) }),
      baseDef(),
      NOW,
    );
    out.push({
      id: "T4",
      name: "Stale evidence (200d)",
      category: "sub_item",
      pass: r.score !== null && close(r.score, 37.5) && r.flag === "stale_required",
      expected: "≈ 37.5 + flag=stale_required",
      actual: `${r.score?.toFixed(2)} flag=${r.flag ?? "none"}`,
    });
  }

  // ---- T5: missing evidence + dq_req=2 → score null, penalty -8 ----
  {
    const r = computeSubItemScore(
      baseResp({ evidence: null }),
      baseDef({ data_quality_required: 2 }),
      NOW,
    );
    out.push({
      id: "T5",
      name: "Missing evidence (dq_req=2) → null + -8",
      category: "sub_item",
      pass: r.score === null && r.penalty === -8,
      expected: "score=null penalty=-8",
      actual: `score=${r.score} penalty=${r.penalty}`,
    });
  }

  // ---- T6: missing evidence + dq_req=1 → belief * 0.7 ----
  // B=3=50, E=null→0.7*50=35, raw=0.35*50+0.65*35=40.25, gap=15 (no penalty) → 40.25
  {
    const r = computeSubItemScore(
      baseResp({ belief: 3, evidence: null }),
      baseDef({ data_quality_required: 1 }),
      NOW,
    );
    out.push({
      id: "T6",
      name: "Missing evidence (dq_req=1) → 40.25",
      category: "sub_item",
      pass: r.score !== null && close(r.score, 40.25),
      expected: "≈ 40.25",
      actual: r.score?.toFixed(2) ?? "null",
    });
  }

  // ---- T7: reverse scoring — PII incidents 0건 (E=1 means best) ----
  // B=5=100, E_raw=1, reverse → E=(5-1)/4*100=100, raw=100, gap=0 → 100
  {
    const r = computeSubItemScore(
      baseResp({ belief: 5, evidence: 1 }),
      baseDef({ reverse_scoring: true }),
      NOW,
    );
    out.push({
      id: "T7",
      name: "Reverse (PII 0건) → 100",
      category: "sub_item",
      pass: r.score !== null && close(r.score, 100),
      expected: "100",
      actual: r.score?.toFixed(2) ?? "null",
    });
  }

  // ---- T8: consensus — N=3 with σ ~ 16.3 → confidence 0.85 ----
  {
    const c = computeConsensus([10, 30, 50]);
    // mean=30, σ = sqrt(((10-30)^2+0+(50-30)^2)/2) = sqrt(400) = 20 → confidence 0.65
    out.push({
      id: "T8",
      name: "Consensus σ=20 (10,30,50) → 0.65",
      category: "consensus",
      pass: !!c && close(c.sigma, 20) && c.confidence === 0.65,
      expected: "σ=20, confidence=0.65, needs_discussion=true",
      actual: c
        ? `σ=${c.sigma.toFixed(2)} conf=${c.confidence} disc=${c.needs_discussion}`
        : "null",
    });
  }

  // ---- T9: failure probability — seed stage, no red critical → posterior=prior ----
  {
    const domainDefs: DomainDef[] = [
      { code: "A2", weight: 13, tier: "critical" },
      { code: "A12", weight: 7, tier: "critical" },
    ];
    const domains: DomainScoreResult[] = [
      { domain: "A2", score: 80, capped: false, missing_penalty: 0, tier_label: "green" },
      { domain: "A12", score: 80, capped: false, missing_penalty: 0, tier_label: "green" },
    ];
    const fp = computeFailureProbability(domains, domainDefs, [], "seed");
    out.push({
      id: "T9",
      name: "FP seed, all green → posterior ≈ prior 0.18 (6m)",
      category: "failure_prob",
      pass: close(fp["6m"].final, 0.18, 0.01) && close(fp["12m"].final, 0.32, 0.01),
      expected: "P(6m) ≈ 0.18, P(12m) ≈ 0.32",
      actual: `6m=${fp["6m"].final.toFixed(3)}, 12m=${fp["12m"].final.toFixed(3)}`,
    });
  }

  // ---- T10: failure probability — A12 red → LR 4.2 multiplied ----
  {
    const domainDefs: DomainDef[] = [
      { code: "A2", weight: 13, tier: "critical" },
      { code: "A12", weight: 7, tier: "critical" },
    ];
    const domains: DomainScoreResult[] = [
      { domain: "A2", score: 80, capped: false, missing_penalty: 0, tier_label: "green" },
      { domain: "A12", score: 25, capped: true, missing_penalty: 0, tier_label: "red" },
    ];
    const fp = computeFailureProbability(domains, domainDefs, [], "seed");
    // prior=0.18, prior_odds=0.18/0.82=0.2195, *4.2=0.9220, posterior=0.4798
    out.push({
      id: "T10",
      name: "FP seed, A12 red → posterior ≈ 0.48 (6m)",
      category: "failure_prob",
      pass: close(fp["6m"].final, 0.48, 0.01),
      expected: "P(6m) ≈ 0.48",
      actual: `6m=${fp["6m"].final.toFixed(3)}, posterior=${fp["6m"].posterior.toFixed(3)}, red=${fp["6m"].red_critical_domains.join(",")}`,
    });
  }

  return out;
}

export function summarize(results: TestResult[]): {
  total: number;
  passed: number;
  failed: number;
  by_category: Record<string, { passed: number; total: number }>;
} {
  const by_category: Record<string, { passed: number; total: number }> = {};
  let passed = 0;
  for (const r of results) {
    if (!by_category[r.category]) by_category[r.category] = { passed: 0, total: 0 };
    by_category[r.category].total++;
    if (r.pass) {
      by_category[r.category].passed++;
      passed++;
    }
  }
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    by_category,
  };
}

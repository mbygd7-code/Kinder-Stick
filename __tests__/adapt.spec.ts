/**
 * adapt.ts 규칙 발화 검증.
 * 실행: npx tsx __tests__/adapt.spec.ts
 */

import { computeOpsContextAdaptation } from "../src/lib/ops-context/adapt";

interface Case {
  name: string;
  ctx: Parameters<typeof computeOpsContextAdaptation>[0];
  expectedDomains: Array<{ domain: string; severity: string }>;
  expectedRuleIds?: string[];
}

const cases: Case[] = [
  {
    name: "데이터 없음 → 시그널 없음",
    ctx: {},
    expectedDomains: [],
  },
  {
    name: "churn 15% → A4 high",
    ctx: { mau: 1000, churn_monthly: 150 },
    expectedDomains: [{ domain: "A4", severity: "high" }],
    expectedRuleIds: ["churn-high"],
  },
  {
    name: "churn 7% → A4 medium",
    ctx: { mau: 1000, churn_monthly: 70 },
    expectedDomains: [{ domain: "A4", severity: "medium" }],
    expectedRuleIds: ["churn-mid"],
  },
  {
    name: "WAU/MAU 25% + churn 15% → A4 high (combined)",
    ctx: { mau: 1000, wau: 250, churn_monthly: 150 },
    expectedDomains: [{ domain: "A4", severity: "high" }],
  },
  {
    name: "paid conv 3% → A3 high",
    ctx: { mau: 1000, paid_users_monthly: 30 },
    expectedDomains: [{ domain: "A3", severity: "high" }],
    expectedRuleIds: ["paid-conv-low"],
  },
  {
    name: "신규 가입 목표 3배 → A6 high",
    ctx: { new_signups_monthly: 100, goal_new_signups_monthly: 300 },
    expectedDomains: [{ domain: "A6", severity: "high" }],
    expectedRuleIds: ["acq-gap-high"],
  },
  {
    name: "신규 가입 목표 1.5배 → A6 medium",
    ctx: { new_signups_monthly: 100, goal_new_signups_monthly: 150 },
    expectedDomains: [{ domain: "A6", severity: "medium" }],
    expectedRuleIds: ["acq-gap-mid"],
  },
  {
    name: "NRR 70% → A13 high",
    ctx: { nrr_rate: 70 },
    expectedDomains: [{ domain: "A13", severity: "high" }],
    expectedRuleIds: ["nrr-weak"],
  },
  {
    name: "D1 활성화 20% → A4 high",
    ctx: { d1_activation_rate: 20 },
    expectedDomains: [{ domain: "A4", severity: "high" }],
    expectedRuleIds: ["d1-low"],
  },
  {
    name: "PLC 목표 → A11 medium",
    ctx: { goal_plc_monthly: 5 },
    expectedDomains: [{ domain: "A11", severity: "medium" }],
    expectedRuleIds: ["plc-focus"],
  },
  {
    name: "종합 — 모든 위험 신호",
    ctx: {
      mau: 1000,
      wau: 250,
      new_signups_monthly: 100,
      goal_new_signups_monthly: 300,
      churn_monthly: 150,
      paid_users_monthly: 30,
      d1_activation_rate: 20,
      nrr_rate: 70,
      goal_plc_monthly: 5,
      goal_paid_subscribers_annual: 200,
    },
    expectedDomains: [
      { domain: "A4", severity: "high" },
      { domain: "A6", severity: "high" },
      { domain: "A3", severity: "high" },
      { domain: "A13", severity: "high" },
      { domain: "A11", severity: "medium" },
    ],
  },
  {
    name: "Healthy 운영 — 시그널 없음",
    ctx: {
      mau: 10000,
      wau: 6000, // 60% WAU/MAU
      churn_monthly: 200, // 2% churn
      paid_users_monthly: 1500, // 15% paid
      d1_activation_rate: 65,
      nrr_rate: 110,
    },
    expectedDomains: [],
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of cases) {
  const out = computeOpsContextAdaptation(c.ctx);
  const actualDomains = out.emphasized.map((d) => ({
    domain: d.domain,
    severity: d.severity,
  }));

  // 1. emphasized domains 비교 (순서 무관)
  const actualSorted = [...actualDomains].sort((a, b) =>
    a.domain.localeCompare(b.domain),
  );
  const expectedSorted = [...c.expectedDomains].sort((a, b) =>
    a.domain.localeCompare(b.domain),
  );
  const domainsMatch =
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted);

  // 2. rule_ids 일부 매칭 검증 (optional)
  let ruleMatch = true;
  if (c.expectedRuleIds) {
    const allFiredRules = new Set(
      out.emphasized.flatMap((d) => d.rule_ids),
    );
    for (const rid of c.expectedRuleIds) {
      if (!allFiredRules.has(rid)) {
        ruleMatch = false;
        break;
      }
    }
  }

  if (domainsMatch && ruleMatch) {
    console.log(`✓ ${c.name}`);
    passed++;
  } else {
    console.log(`✗ ${c.name}`);
    console.log("    expected:", JSON.stringify(expectedSorted));
    console.log("    actual:", JSON.stringify(actualSorted));
    if (!ruleMatch && c.expectedRuleIds) {
      console.log("    expected rule ids:", c.expectedRuleIds);
      console.log(
        "    actual rule ids:",
        out.emphasized.flatMap((d) => d.rule_ids),
      );
    }
    failed++;
    failures.push(c.name);
  }
}

console.log(`\n=== ${passed} passed / ${failed} failed (${cases.length} total) ===`);
if (failures.length > 0) {
  console.log("Failed:", failures.join(" · "));
  process.exit(1);
}

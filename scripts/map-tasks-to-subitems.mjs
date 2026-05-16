#!/usr/bin/env node
/**
 * map-tasks-to-subitems.mjs
 *
 * 3-tier 진단 신뢰도 모델 Phase 2 — AI 자동 매핑.
 *
 * 각 worklist task 에 대해 어떤 framework sub_item 들이 가장 적합한
 * evidence target 인지 Claude 가 추천하여 JSON 으로 저장.
 *
 * 사용:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/map-tasks-to-subitems.mjs
 *
 * 옵션:
 *   --task=ID         특정 task 만 (디버깅)
 *   --domain=A2       특정 domain 의 task 만
 *   --concurrency=N   동시 요청 수 (기본 4)
 *   --merge           기존 mapping 유지하고 비어 있는 task 만 채움
 *
 * 결과: public/task-subitem-mappings.json
 *   { generated_at, model, entries: [{ task_id, sub_items, reasoning, confidence }] }
 *
 * 런타임 적용:
 *   /api/worklist/kpi-evidence 라우트가 catalog.kpi_sub_items 를 우선 보고
 *   비어 있으면 이 JSON 을 fallback 으로 조회 (현재 도메인 확장 fallback 보다 정확).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(ROOT, "public/task-subitem-mappings.json");
const FRAMEWORK_YAML = resolve(ROOT, "framework/question_bank.yaml");
const PLAYBOOKS_JSON = resolve(ROOT, "public/playbook-defaults.json");

const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  acc[k] = v ?? true;
  return acc;
}, {});

const CONCURRENCY = Number(args.concurrency ?? 4);
const ONLY_TASK = typeof args.task === "string" ? args.task : null;
const ONLY_DOMAIN = typeof args.domain === "string" ? args.domain : null;
const MERGE = !!args.merge;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY 가 필요합니다.");
  process.exit(1);
}

// ── load framework ───────────────────────────────────────────────
if (!existsSync(FRAMEWORK_YAML)) {
  console.error(`framework yaml not found: ${FRAMEWORK_YAML}`);
  process.exit(1);
}
const framework = parseYaml(readFileSync(FRAMEWORK_YAML, "utf-8"));

// flatten sub_items with domain code for prompt
const allSubItems = [];
for (const d of framework.domains ?? []) {
  for (const g of d.groups ?? []) {
    for (const s of g.sub_items ?? []) {
      allSubItems.push({
        code: s.code,
        domain: d.code,
        domain_name: d.name_ko,
        group: g.code,
        tier: s.tier,
        weight: s.weight_within_group,
        question: s.belief?.q ?? "",
        failure_trigger: s.failure_trigger ?? "",
      });
    }
  }
}
console.log(`framework: ${allSubItems.length} sub_items loaded`);

// ── load tasks from playbook-defaults (lightweight) ──────────────
if (!existsSync(PLAYBOOKS_JSON)) {
  console.error(
    `${PLAYBOOKS_JSON} 가 없습니다. 먼저 generate-default-playbooks.mjs 를 실행하세요.`,
  );
  process.exit(1);
}
const playbooks = JSON.parse(readFileSync(PLAYBOOKS_JSON, "utf-8"));
let tasks = (playbooks.entries ?? []).map((e) => ({
  task_id: e.task_id,
  title: e.data?.summary?.title ?? e.task_id,
  kpis: e.data?.kpis ?? [],
  domain: e.data?.meta?.domain ?? null,
}));

if (ONLY_TASK) tasks = tasks.filter((t) => t.task_id === ONLY_TASK);
if (ONLY_DOMAIN) tasks = tasks.filter((t) => t.domain === ONLY_DOMAIN);

// ── load existing mappings for --merge ──────────────────────────
let existing = { entries: [] };
if (MERGE && existsSync(OUT_PATH)) {
  existing = JSON.parse(readFileSync(OUT_PATH, "utf-8"));
  const have = new Set(existing.entries.map((e) => e.task_id));
  tasks = tasks.filter((t) => !have.has(t.task_id));
  console.log(`merge mode: ${tasks.length} unmapped tasks remaining`);
}

console.log(`mapping ${tasks.length} tasks…`);

// ── Anthropic call ───────────────────────────────────────────────
const MODEL = "claude-haiku-4-5-20251001";

function buildPrompt(task) {
  const subItemsList = allSubItems
    .map(
      (s) =>
        `${s.code} [${s.tier}, weight=${s.weight}] domain=${s.domain}(${s.domain_name}) — Q: ${s.question}`,
    )
    .join("\n");

  return `당신은 스타트업 진단 프레임워크의 expert 입니다.

아래 worklist task 가 잘 실행되었을 때(KPI 충족) 가장 직접적으로 영향받는 sub_item 1~3개를 골라주세요.

# Task
ID: ${task.task_id}
제목: ${task.title}
KPI: ${task.kpis.map((k) => `- ${k.name} (목표 ${k.threshold}, 측정 ${k.method})`).join("\n")}
주 도메인: ${task.domain ?? "unspecified"}

# 후보 Sub-items
${subItemsList}

# 출력 (JSON only, no prose)
{
  "sub_items": ["A2.SE.40", "..."],
  "reasoning": "한 줄로 왜 선택했는지",
  "confidence": 0.0-1.0
}

선택 기준:
- task 실행이 sub_item 의 belief 질문에 대한 답을 실제로 개선하는가?
- critical / important tier 우선
- 너무 많이 선택하지 마세요 — 1~2개 정도가 이상적`;
}

async function callClaude(task, retries = 2) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: buildPrompt(task) }],
    }),
  });
  if (!res.ok) {
    if (retries > 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000));
      return callClaude(task, retries - 1);
    }
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  const text = body.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in response");
  const parsed = JSON.parse(m[0]);
  // validate sub_items exist in framework
  const valid = (parsed.sub_items ?? []).filter((c) =>
    allSubItems.some((s) => s.code === c),
  );
  return {
    sub_items: valid,
    reasoning: parsed.reasoning ?? "",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };
}

// ── worker pool ─────────────────────────────────────────────────
const results = [...existing.entries];
let cursor = 0;
let processed = 0;

async function worker(id) {
  while (cursor < tasks.length) {
    const i = cursor++;
    const task = tasks[i];
    try {
      const r = await callClaude(task);
      results.push({
        task_id: task.task_id,
        sub_items: r.sub_items,
        reasoning: r.reasoning,
        confidence: r.confidence,
      });
      processed++;
      console.log(
        `[${processed}/${tasks.length}] ${task.task_id} → ${r.sub_items.join(",") || "(none)"} conf=${r.confidence}`,
      );
    } catch (e) {
      console.error(`✗ ${task.task_id}: ${e.message}`);
    }
  }
}

const start = Date.now();
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, (_, i) =>
    worker(i),
  ),
);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

// ── write output ────────────────────────────────────────────────
const output = {
  generated_at: new Date().toISOString(),
  model: MODEL,
  total: results.length,
  entries: results,
};
writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf-8");
console.log(
  `\n✓ ${results.length} mappings → ${OUT_PATH}  (${elapsed}s, $${(processed * 0.0008).toFixed(2)} est)`,
);

#!/usr/bin/env node
/**
 * generate-default-playbooks.mjs
 *
 * 한 번 실행 → 모든 task 의 default playbook 을 미리 생성 →
 * `public/playbook-defaults.json` 으로 저장. 사용자가 워크리스트 페이지를 처음
 * 열 때 이 JSON 이 즉시 시드되어 AI 호출 없이 모든 카드가 채워진 채로 나타난다.
 *
 * 사용:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-default-playbooks.mjs
 *
 * 옵션:
 *   --concurrency=N   동시 요청 수 (기본 6)
 *   --only-missing    기존 JSON 의 hash 와 다른 task 만 재생성 (증분 모드)
 *   --task=ID         특정 task 만 (디버깅용)
 *
 * 비용·시간:
 *   - 한 번 풀 실행: ~30분, 약 0.5–1.5 USD (haiku-4-5 + prompt cache)
 *   - 증분 (--only-missing): 보통 5개 미만, 1분 이내
 *
 * 결과:
 *   public/playbook-defaults.json
 *   {
 *     generated_at: ISO,
 *     cache_version: "v5",
 *     entries: [{ task_id, task_hash, data: {summary, output, steps, ...} }]
 *   }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(ROOT, "public/playbook-defaults.json");

// ── CLI args ─────────────────────────────────────────────────────
const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  acc[k] = v ?? true;
  return acc;
}, {});
const CONCURRENCY = Number(args.concurrency ?? 6);
const ONLY_MISSING = !!args["only-missing"];
const ONLY_TASK = typeof args.task === "string" ? args.task : null;

// ── Anthropic API key check ──────────────────────────────────────
// 실제 API 호출은 dev 서버 (/api/worklist/playbook) 가 수행하므로,
// 스크립트 자체에는 키가 필요하지 않다. 단, dev 서버가 키를 가지고
// 있어야 함 → .env.local 에서 로드 여부만 확인.
function readEnvLocal() {
  const path = resolve(ROOT, ".env.local");
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("ANTHROPIC_API_KEY=")) {
        const v = t.slice("ANTHROPIC_API_KEY=".length).trim();
        if (v) return v;
      }
    }
    return null;
  } catch {
    return null;
  }
}
// `??` 대신 `||` — 셸이 빈 문자열로 export 한 경우도 fallback 으로 처리.
const KEY = process.env.ANTHROPIC_API_KEY || readEnvLocal();
if (!KEY) {
  console.error("[error] ANTHROPIC_API_KEY 가 .env.local 또는 환경변수에 없습니다.");
  console.error("        .env.local 에 ANTHROPIC_API_KEY=sk-ant-... 추가 후 dev 서버를 재시작하세요.");
  process.exit(1);
}

// ── Import TASKS via tsx (TS module 직접 실행) ───────────────────
// catalog 는 큰 TS 파일이므로 ESM transpile 도구 없이 단순 eval 은 불가.
// 대신 dev API 서버에 연결할 때만 사용하므로, dev server 가 떠 있어야 한다.
const DEV_BASE = process.env.PLAYBOOK_DEV_BASE ?? "http://localhost:3000";

async function fetchTasks() {
  // dev server 의 라우트가 TASKS 를 노출하지 않으므로 우회: 카탈로그를 직접 import 할 수 있는
  // 가벼운 endpoint 를 만들거나, 여기서는 catalog.ts 를 정규식으로 파싱하지 않고
  // 별도 worklist:tasks API 가 없으면 사용자에게 안내.
  //
  // MVP: 사용자가 dev 서버 내부에서 직접 실행하기 위해, fetch /api/_internal/tasks 를 시도.
  // 그게 없으면 명확한 에러를 띄움.
  const r = await fetch(`${DEV_BASE}/api/internal-tasks`);
  if (!r.ok) {
    throw new Error(
      `[fatal] /api/internal-tasks 호출 실패 (${r.status}). dev 서버 (${DEV_BASE}) 가 실행 중인지 확인하세요.`,
    );
  }
  return await r.json();
}

async function generateOne(task) {
  const r = await fetch(`${DEV_BASE}/api/worklist/playbook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: task.id,
      title: task.title,
      why: task.why,
      team: task.team,
      phase: task.phase,
      funnel_stage: task.funnel_stage,
      cadence: task.cadence,
      tier: task.tier,
      domain: task.domain,
      hint: task.hint,
      ai_leverage: task.ai_leverage,
      // ops_context 의도적 생략 → generic default
    }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  return await r.json();
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log("[info] tasks fetch from dev server …");
  const tasks = await fetchTasks();
  console.log(`[info] ${tasks.length} tasks loaded`);

  // 기존 결과 (증분 모드용)
  let existing = { entries: [] };
  if (ONLY_MISSING && existsSync(OUT_PATH)) {
    try {
      existing = JSON.parse(readFileSync(OUT_PATH, "utf8"));
    } catch {}
  }
  const existingByHash = new Map();
  for (const e of existing.entries ?? []) {
    existingByHash.set(`${e.task_id}:${e.task_hash}`, e);
  }

  // 작업 큐
  const todo = tasks.filter((t) => {
    if (ONLY_TASK && t.id !== ONLY_TASK) return false;
    if (ONLY_MISSING && existingByHash.has(`${t.id}:${t.task_hash}`)) return false;
    return true;
  });
  console.log(`[info] generating ${todo.length} entries (concurrency=${CONCURRENCY})`);

  // 결과 누적: 기존 + 새로 생성
  const results = new Map();
  for (const e of existing.entries ?? []) results.set(e.task_id, e);

  let done = 0;
  let failed = 0;
  let idx = 0;
  const t0 = Date.now();

  async function worker() {
    while (idx < todo.length) {
      const myIdx = idx++;
      const task = todo[myIdx];
      try {
        const data = await generateOne(task);
        results.set(task.id, {
          task_id: task.id,
          task_hash: task.task_hash,
          data,
        });
        done++;
        const eta = Math.round(((Date.now() - t0) / done) * (todo.length - done) / 1000);
        console.log(`  [${done}/${todo.length}] ✓ ${task.id} (eta ~${eta}s)`);
      } catch (e) {
        failed++;
        console.error(`  [${done + failed}/${todo.length}] ✗ ${task.id}: ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // ── Write output ───────────────────────────────────────────────
  const bundle = {
    generated_at: new Date().toISOString(),
    cache_version: "v5",
    entries: Array.from(results.values()).sort((a, b) => a.task_id.localeCompare(b.task_id)),
  };

  if (!existsSync(dirname(OUT_PATH))) mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(bundle, null, 2));
  console.log(
    `\n[done] ${bundle.entries.length} entries written to ${OUT_PATH}` +
      (failed > 0 ? `  (실패 ${failed}건 — 증분 모드로 재실행 권장)` : ""),
  );
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});

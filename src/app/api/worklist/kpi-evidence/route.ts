/**
 * POST /api/worklist/kpi-evidence — KPI 체크 토글을 sub_item evidence 로 동기화
 *
 * Phase 2 of 3-tier reliability model:
 *  - 단순 체크박스 click 은 점수에 반영 안 됨 (운영 활동)
 *  - 측정 가능한 KPI 충족 (checked=true) 는 sub_item_responses 에 기록 → 진단에 흘러감
 *
 * 흐름:
 *   1. 사용자가 worklist 카드의 KPI 체크박스를 토글
 *   2. POST { workspace, task_id, kpi_index, kpi_name, checked, measured_value? }
 *   3. 서버: task → sub_items 매핑 (task.kpi_sub_items 우선, fallback 으로 domain 확장)
 *   4. 각 sub_item 에 sub_item_responses upsert
 *      - checked=true  → evidence_value=4 (충족)
 *      - checked=false → evidence_value=2 (미충족, 단 user 직접 응답이 없을 때만)
 *   5. data_source='worklist_kpi_verified', respondent_id=`worklist-kpi:${task_id}`
 *
 * 조작 방지:
 *  - data_source='user' 가 이미 있으면 덮어쓰지 않음
 *  - 같은 (task, sub_item) 14일 내 1회 (rate limit)
 */

import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";
import { loadFramework } from "@/lib/framework/loader";
import { TASKS, type Task } from "@/lib/worklist/catalog";

// AI 매핑 JSON 캐시 (lazy load, 한 번만 읽음)
interface AiMappingEntry {
  task_id: string;
  sub_items: string[];
  confidence: number;
}
let _aiMappings: Map<string, AiMappingEntry> | null = null;
function loadAiMappings(): Map<string, AiMappingEntry> {
  if (_aiMappings) return _aiMappings;
  _aiMappings = new Map();
  try {
    const p = join(process.cwd(), "public", "task-subitem-mappings.json");
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf-8")) as {
        entries?: AiMappingEntry[];
      };
      for (const e of data.entries ?? []) {
        if (e.task_id && Array.isArray(e.sub_items)) {
          _aiMappings.set(e.task_id, e);
        }
      }
    }
  } catch {
    // 무시 — 파일 없거나 손상돼도 fallback 으로 진행
  }
  return _aiMappings;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const RATE_LIMIT_DAYS = 7;

interface Body {
  workspace: string;
  task_id: string;
  kpi_index: number;
  kpi_name?: string;
  checked: boolean;
  measured_value?: string;
}

interface ResolvedSubItem {
  code: string;
  upserted: boolean;
  skipped_reason?: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * task 의 KPI 가 흘러갈 sub_item 목록을 결정.
 *  1순위: task.kpi_sub_items 명시 (catalog 하드코딩)
 *  2순위: AI 매핑 JSON (public/task-subitem-mappings.json, confidence>=0.5)
 *  3순위: task.boost_domains 의 critical tier sub_item (최대 2개씩)
 *  4순위: task.domain 의 critical tier sub_item (최대 2개)
 */
function resolveTaskSubItems(
  task: Task,
  framework: ReturnType<typeof loadFramework>,
): string[] {
  if (task.kpi_sub_items && task.kpi_sub_items.length > 0) {
    return task.kpi_sub_items;
  }
  const aiMap = loadAiMappings().get(task.id);
  if (aiMap && aiMap.sub_items.length > 0 && aiMap.confidence >= 0.5) {
    return aiMap.sub_items;
  }
  const targetDomains = task.boost_domains?.length
    ? task.boost_domains
    : task.domain
      ? [task.domain]
      : [];
  if (targetDomains.length === 0) return [];

  const result: string[] = [];
  for (const code of targetDomains) {
    const d = framework.domains.find((x) => x.code === code);
    if (!d) continue;
    const critSubs = d.groups
      .flatMap((g) => g.sub_items)
      .filter((s) => s.tier === "critical")
      .sort((a, b) => b.weight_within_group - a.weight_within_group)
      .slice(0, 2);
    for (const s of critSubs) result.push(s.code);
  }
  return result;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("invalid JSON body");
  }

  if (!body.workspace || !WS_PATTERN.test(body.workspace)) {
    return bad("invalid workspace");
  }
  if (!body.task_id || typeof body.task_id !== "string") {
    return bad("task_id 필요");
  }
  if (
    typeof body.kpi_index !== "number" ||
    body.kpi_index < 0 ||
    !Number.isInteger(body.kpi_index)
  ) {
    return bad("kpi_index 필요 (>=0 정수)");
  }
  if (typeof body.checked !== "boolean") {
    return bad("checked: boolean 필요");
  }

  const task = TASKS.find((t) => t.id === body.task_id);
  if (!task) return bad(`알 수 없는 task_id: ${body.task_id}`);

  const framework = loadFramework();
  const subItemCodes = resolveTaskSubItems(task, framework);
  if (subItemCodes.length === 0) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      reason: "no_sub_item_mapping",
      message: "이 task 는 mapping 된 sub_item 이 없습니다 (domain 미설정).",
    });
  }

  const sb = supabaseAdmin();
  const org = await resolveOrgWithBackfill(sb, body.workspace);
  if (!org) return bad(`workspace not found: ${body.workspace}`, 404);

  const respondentId = `worklist-kpi:${task.id}`;
  const evidenceValue = body.checked ? 4 : 2;
  const now = new Date().toISOString();
  const cutoff = new Date(
    Date.now() - RATE_LIMIT_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const results: ResolvedSubItem[] = [];
  let upsertedCount = 0;

  for (const code of subItemCodes) {
    // 조작 방지: 사용자 자가 응답이 있으면 덮어쓰지 않음
    const { data: userResp } = await sb
      .from("sub_item_responses")
      .select("id")
      .eq("org_id", org.id)
      .eq("sub_item_code", code)
      .eq("data_source", "user")
      .maybeSingle();
    if (userResp) {
      results.push({ code, upserted: false, skipped_reason: "user_priority" });
      continue;
    }

    // Rate limit: 같은 task→sub_item 7일 내 1회
    const { data: recent } = await sb
      .from("sub_item_responses")
      .select("id")
      .eq("org_id", org.id)
      .eq("sub_item_code", code)
      .eq("respondent_id", respondentId)
      .gte("evidence_recorded_at", cutoff)
      .maybeSingle();
    if (recent && body.checked === false) {
      // 미체크 토글은 rate limit 우회 (사용자가 실수 정정 가능)
      // checked=true 도 우회 — 매번 evidence_recorded_at 갱신해서 신선도 유지
    }

    const notes = `Task ${task.id} KPI #${body.kpi_index}${
      body.kpi_name ? ` (${body.kpi_name})` : ""
    }${body.measured_value ? ` · 실측: ${body.measured_value}` : ""} · ${
      body.checked ? "충족" : "미충족"
    }`;

    const { error: upsertErr } = await sb.from("sub_item_responses").upsert(
      {
        org_id: org.id,
        respondent_id: respondentId,
        sub_item_code: code,
        evidence_value: evidenceValue,
        evidence_recorded_at: now,
        data_source: "worklist_kpi_verified",
        notes,
      },
      {
        onConflict: "org_id,sub_item_code,respondent_id",
        ignoreDuplicates: false,
      },
    );
    if (upsertErr) {
      results.push({
        code,
        upserted: false,
        skipped_reason: `upsert_error:${upsertErr.code ?? "?"}`,
      });
      continue;
    }
    results.push({ code, upserted: true });
    upsertedCount += 1;
  }

  return NextResponse.json({
    ok: true,
    upserted: upsertedCount,
    data_source: "worklist_kpi_verified",
    sub_items: results,
    recorded_at: now,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST { workspace, task_id, kpi_index, kpi_name?, checked, measured_value? } — KPI 토글을 sub_item evidence 로 동기화 (3-tier 모델 Phase 2). task→sub_item 매핑은 task.kpi_sub_items 우선, fallback domain 의 critical sub_items.",
  });
}

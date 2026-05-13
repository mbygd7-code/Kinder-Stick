/**
 * POST /api/worklist/task-evidence — task 완료 시 sub_item 에 evidence 수동 기록
 *
 * 흐름:
 *   1. 사용자가 worklist UI 에서 task 완료 + "결과 sub_item evidence 도 갱신" 체크
 *   2. POST { workspace, task_id, sub_item_code, evidence_value, note }
 *   3. 서버 검증:
 *      a. task_id 가 INFERRED_TASK_DOMAINS 또는 catalog 에 존재
 *      b. sub_item_code 가 framework 에 존재
 *      c. evidence_value 1-5 범위
 *      d. 같은 workspace 의 user 자가 기록 데이터가 있으면 덮어쓰지 않음 (조작 방지)
 *   4. sub_item_responses upsert (data_source='worklist_task_done')
 *
 * 조작 방지 게이트:
 *   - data_source='user' 인 기존 응답은 덮어쓰지 않음 — task 완료가 직접 사용자 답을 바꾸지 못함
 *   - data_source='worklist_task_done' 또는 'kpi_derive_auto' 만 자동 갱신 가능
 *   - 같은 sub_item 에 14일 내 동일 출처 기록이 이미 있으면 skip (스팸 방지)
 *
 * 반환: { ok, upserted, skipped, reason }
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";
import { loadFramework } from "@/lib/framework/loader";
import { TASKS } from "@/lib/worklist/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const SUB_PATTERN = /^[A-Z][0-9]+\.[A-Z0-9.]+$/;
const RATE_LIMIT_DAYS = 14; // 같은 (org, sub_item, source) 14일 내 1회만

interface Body {
  workspace: string;
  task_id: string;
  sub_item_code: string;
  evidence_value: number;
  note?: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
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
  if (!body.sub_item_code || !SUB_PATTERN.test(body.sub_item_code)) {
    return bad("invalid sub_item_code (예: A2.SE.40)");
  }
  const ev = body.evidence_value;
  if (typeof ev !== "number" || ev < 1 || ev > 5 || !Number.isInteger(ev)) {
    return bad("evidence_value 는 1-5 정수");
  }

  // 검증 1: task_id 가 catalog 에 있는지
  const task = TASKS.find((t) => t.id === body.task_id);
  if (!task) {
    return bad(`알 수 없는 task_id: ${body.task_id}`);
  }

  // 검증 2: sub_item_code 가 framework 에 존재하는지
  const framework = loadFramework();
  let found = false;
  for (const d of framework.domains) {
    for (const g of d.groups) {
      if (g.sub_items.some((s) => s.code === body.sub_item_code)) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) {
    return bad(`알 수 없는 sub_item_code: ${body.sub_item_code}`);
  }

  const sb = supabaseAdmin();
  const org = await resolveOrgWithBackfill(sb, body.workspace);
  if (!org) {
    return bad(`workspace not found: ${body.workspace}`, 404);
  }

  // 조작 방지 게이트: 같은 sub_item 에 user 자가 기록이 있으면 덮어쓰지 않음.
  // user 기록 부재 시에만 worklist 자동 기록 가능.
  const respondentId = `worklist:${task.id}`;
  const { data: userResponse } = await sb
    .from("sub_item_responses")
    .select("id, data_source, evidence_recorded_at")
    .eq("org_id", org.id)
    .eq("sub_item_code", body.sub_item_code)
    .eq("data_source", "user")
    .maybeSingle();

  if (userResponse) {
    return NextResponse.json({
      ok: false,
      upserted: false,
      reason: "user_response_exists",
      message:
        "이 sub_item 에 사용자 자가 기록이 이미 있습니다. task 완료가 사용자 응답을 덮어쓸 수 없습니다 (조작 방지).",
    });
  }

  // Rate limit: 같은 sub_item 에 14일 내 동일 출처 기록이 있으면 skip
  const cutoff = new Date(
    Date.now() - RATE_LIMIT_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: recent } = await sb
    .from("sub_item_responses")
    .select("id, evidence_recorded_at")
    .eq("org_id", org.id)
    .eq("sub_item_code", body.sub_item_code)
    .eq("respondent_id", respondentId)
    .gte("evidence_recorded_at", cutoff)
    .maybeSingle();

  if (recent) {
    return NextResponse.json({
      ok: true,
      upserted: false,
      reason: "rate_limited",
      message: `이 task 가 이 sub_item 을 ${RATE_LIMIT_DAYS}일 내 이미 갱신했습니다. 다음 갱신까지 대기.`,
    });
  }

  // upsert — atomic, race-condition-free
  // onConflict: (org_id, sub_item_code, respondent_id) 의 unique 제약 기준.
  // 같은 task 가 다른 워크플로우(예: 수동 + 자동)로 동시에 호출돼도 안전.
  const now = new Date().toISOString();
  const { error: upsertErr } = await sb.from("sub_item_responses").upsert(
    {
      org_id: org.id,
      respondent_id: respondentId,
      sub_item_code: body.sub_item_code,
      evidence_value: ev,
      evidence_recorded_at: now,
      data_source: "worklist_task_done",
      notes: body.note ?? `Task ${body.task_id} 완료로 자동 기록됨`,
    },
    {
      onConflict: "org_id,sub_item_code,respondent_id",
      ignoreDuplicates: false,
    },
  );

  if (upsertErr) {
    return NextResponse.json(
      {
        ok: false,
        upserted: false,
        message: `UPSERT 실패: ${upsertErr.code ?? "?"}: ${upsertErr.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    upserted: true,
    sub_item_code: body.sub_item_code,
    evidence_value: ev,
    data_source: "worklist_task_done",
    recorded_at: now,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST { workspace, task_id, sub_item_code, evidence_value (1-5), note? } — task 완료 시 sub_item evidence 자동 기록. 조작 방지 게이트 적용.",
  });
}

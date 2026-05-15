/**
 * /api/worklist/kpi-checks
 *
 * 팀 공유 KPI 체크 진행 상태 — Supabase 의 kso_worklist_kpi_checks 테이블 read/write.
 *
 * 인증 패턴 (kso_ops_context, kso_worklist_playbooks 와 동일):
 *   - service_role 키 (supabaseAdmin) 로 DB 접근
 *   - PIN 세션 검증 (getCurrentProfile) 으로 사용자 인증
 *   - 익명/세션 없음 → graceful 빈 응답 (클라이언트는 localStorage 만 사용)
 *
 * GET ?workspace=...
 *   해당 워크스페이스의 모든 KPI 체크 entry 반환 → 클라이언트가 한 번에 hydrate.
 *   응답: { entries: [{ task_id, checked, updated_at }], shared: bool }
 *
 * POST { workspace, task_id, checked: number[] }
 *   upsert. 같은 워크스페이스 멤버라면 다른 사람의 체크가 즉시 공유됨.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,80}$/;

interface PostBody {
  workspace?: string;
  task_id?: string;
  checked?: unknown;
}

// ─── GET ───────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = (url.searchParams.get("workspace") ?? "").trim();
  if (!WS_PATTERN.test(workspace)) {
    return NextResponse.json({ error: "invalid_workspace" }, { status: 400 });
  }

  // PIN 세션 없으면 graceful — 클라이언트는 localStorage 만 사용
  const me = await getCurrentProfile().catch(() => null);
  if (!me) {
    return NextResponse.json({ entries: [], shared: false }, { status: 200 });
  }

  // Supabase 미설정 (mock mode) — graceful 빈 응답
  let sb;
  try {
    sb = supabaseAdmin();
  } catch {
    return NextResponse.json({ entries: [], shared: false }, { status: 200 });
  }

  const { data, error } = await sb
    .from("kso_worklist_kpi_checks")
    .select("task_id,checked,updated_at")
    .eq("workspace_id", workspace);

  if (error) {
    return NextResponse.json(
      { error: "supabase_error", detail: error.message, entries: [] },
      { status: 502 },
    );
  }

  return NextResponse.json({ entries: data ?? [], shared: true });
}

// ─── POST ──────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const workspace = (body.workspace ?? "").trim();
  const task_id = (body.task_id ?? "").trim();

  if (!WS_PATTERN.test(workspace)) {
    return NextResponse.json({ error: "invalid_workspace" }, { status: 400 });
  }
  if (!task_id) {
    return NextResponse.json(
      { error: "missing_fields", required: ["workspace", "task_id", "checked"] },
      { status: 400 },
    );
  }

  // checked: number[] 검증 — 안전하게 정수만 통과
  const rawChecked = Array.isArray(body.checked) ? body.checked : [];
  const checked: number[] = [];
  for (const v of rawChecked) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 256) {
      checked.push(v);
    }
  }
  // 중복 제거 + 정렬 (저장 일관성)
  const uniqueChecked = Array.from(new Set(checked)).sort((a, b) => a - b);

  const me = await getCurrentProfile().catch(() => null);
  if (!me) {
    // 익명 — 공유 캐시 저장 안 함, graceful
    return NextResponse.json({ ok: false, shared: false }, { status: 200 });
  }

  let sb;
  try {
    sb = supabaseAdmin();
  } catch {
    return NextResponse.json({ ok: false, shared: false }, { status: 200 });
  }

  const { error } = await sb.from("kso_worklist_kpi_checks").upsert(
    {
      workspace_id: workspace,
      task_id: task_id.slice(0, 80),
      checked: uniqueChecked,
      updated_by: me.id,
    },
    { onConflict: "workspace_id,task_id" },
  );

  if (error) {
    return NextResponse.json(
      { error: "supabase_error", detail: error.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, shared: true });
}

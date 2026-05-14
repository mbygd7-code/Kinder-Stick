/**
 * GET  /api/ops-context/[workspace]
 *   → { data, applied_at, applied_by, applied_by_email, revision }
 *
 * PUT  /api/ops-context/[workspace]
 *   body: { data: Partial<OpsContext> }
 *   → 변경된 필드별로 kso_ops_context_changes 에 기록 + kso_ops_context upsert
 *   → "진단에 반영" 버튼 클릭 시 호출
 *
 * 인증 필요 (PIN 세션). 익명은 401.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

// ── GET — 최신 commit ──
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspace: string }> },
) {
  const { workspace } = await ctx.params;
  if (!WS_PATTERN.test(workspace)) {
    return NextResponse.json(
      { ok: false, message: "workspace 형식 오류" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data: row } = await sb
    .from("kso_ops_context")
    .select("data, applied_at, applied_by, revision")
    .eq("workspace_id", workspace)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({
      ok: true,
      data: {},
      applied_at: null,
      applied_by: null,
      applied_by_email: null,
      applied_by_name: null,
      revision: 0,
    });
  }

  // applied_by profile 정보
  let applied_by_email: string | null = null;
  let applied_by_name: string | null = null;
  if (row.applied_by) {
    const { data: p } = await sb
      .from("kso_profiles")
      .select("email, display_name")
      .eq("id", row.applied_by)
      .maybeSingle();
    applied_by_email = (p?.email as string | null) ?? null;
    applied_by_name = (p?.display_name as string | null) ?? null;
  }

  return NextResponse.json({
    ok: true,
    data: row.data ?? {},
    applied_at: row.applied_at,
    applied_by: row.applied_by,
    applied_by_email,
    applied_by_name,
    revision: row.revision ?? 1,
  });
}

// ── PUT — commit ("진단에 반영") ──
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ workspace: string }> },
) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  const { workspace } = await ctx.params;
  if (!WS_PATTERN.test(workspace)) {
    return NextResponse.json(
      { ok: false, message: "workspace 형식 오류" },
      { status: 400 },
    );
  }

  let body: { data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "잘못된 JSON" },
      { status: 400 },
    );
  }

  const newData = (body.data ?? {}) as Record<string, unknown>;
  if (typeof newData !== "object" || newData === null || Array.isArray(newData)) {
    return NextResponse.json(
      { ok: false, message: "data 는 객체여야 합니다" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // 기존 row 가져와 diff 산출
  const { data: existing } = await sb
    .from("kso_ops_context")
    .select("data, revision")
    .eq("workspace_id", workspace)
    .maybeSingle();

  const oldData = (existing?.data as Record<string, unknown> | null) ?? {};
  const revision = ((existing?.revision as number) ?? 0) + 1;

  // 변경된 필드 식별
  const allKeys = new Set([
    ...Object.keys(oldData),
    ...Object.keys(newData),
  ]);
  const changes: Array<{
    field_name: string;
    old_value: unknown;
    new_value: unknown;
  }> = [];
  for (const key of allKeys) {
    if (key === "updated_at") continue; // 메타 필드 skip
    const oldV = oldData[key];
    const newV = newData[key];
    if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
      changes.push({
        field_name: key,
        old_value: oldV === undefined ? null : oldV,
        new_value: newV === undefined ? null : newV,
      });
    }
  }

  const now = new Date().toISOString();

  // upsert 본 row
  const { error: upsertErr } = await sb
    .from("kso_ops_context")
    .upsert(
      {
        workspace_id: workspace,
        data: newData,
        applied_at: now,
        applied_by: me.id,
        revision,
      },
      { onConflict: "workspace_id" },
    );
  if (upsertErr) {
    return NextResponse.json(
      { ok: false, message: `저장 실패: ${upsertErr.message}` },
      { status: 500 },
    );
  }

  // change log INSERT (변경 있을 때만)
  if (changes.length > 0) {
    const rows = changes.map((c) => ({
      workspace_id: workspace,
      field_name: c.field_name,
      old_value: c.old_value,
      new_value: c.new_value,
      changed_by: me.id,
      changed_at: now,
    }));
    const { error: logErr } = await sb
      .from("kso_ops_context_changes")
      .insert(rows);
    if (logErr) {
      // 본 저장은 성공했으므로 로그 실패는 warning 만
      console.error("ops_context_changes log failed:", logErr.message);
    }
  }

  return NextResponse.json({
    ok: true,
    revision,
    changes_count: changes.length,
    applied_at: now,
    applied_by: me.id,
    applied_by_email: me.email,
  });
}

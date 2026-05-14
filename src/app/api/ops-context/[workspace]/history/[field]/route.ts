/**
 * GET /api/ops-context/[workspace]/history/[field]
 *   → [{ id, old_value, new_value, changed_at, changed_by, changed_by_email, changed_by_name }, ...]
 *
 * 한 필드의 모든 변경 이력 (최신순). 이력 modal 에서 사용.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,50}$/;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspace: string; field: string }> },
) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  const { workspace, field } = await ctx.params;
  if (!WS_PATTERN.test(workspace) || !FIELD_PATTERN.test(field)) {
    return NextResponse.json(
      { ok: false, message: "워크스페이스 또는 필드명 형식 오류" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data: rows, error } = await sb
    .from("kso_ops_context_changes")
    .select("id, old_value, new_value, changed_at, changed_by")
    .eq("workspace_id", workspace)
    .eq("field_name", field)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  // changed_by profile lookup (batch)
  const ids = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => r.changed_by as string | null)
        .filter((v): v is string => v !== null),
    ),
  );
  const profileMap = new Map<
    string,
    { email: string | null; display_name: string | null }
  >();
  if (ids.length > 0) {
    const { data: ps } = await sb
      .from("kso_profiles")
      .select("id, email, display_name")
      .in("id", ids);
    for (const p of (ps ?? []) as Array<{
      id: string;
      email: string | null;
      display_name: string | null;
    }>) {
      profileMap.set(p.id, {
        email: p.email,
        display_name: p.display_name,
      });
    }
  }

  const enriched = (rows ?? []).map((r) => ({
    id: r.id,
    old_value: r.old_value,
    new_value: r.new_value,
    changed_at: r.changed_at,
    changed_by: r.changed_by,
    changed_by_email: r.changed_by ? profileMap.get(r.changed_by)?.email ?? null : null,
    changed_by_name: r.changed_by ? profileMap.get(r.changed_by)?.display_name ?? null : null,
  }));

  return NextResponse.json({ ok: true, history: enriched });
}

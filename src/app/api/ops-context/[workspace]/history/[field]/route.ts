/**
 * GET /api/ops-context/[workspace]/history/[field]
 *   → [{ id, old_value, new_value, changed_at, changed_by, changed_by_email, changed_by_name }, ...]
 *
 * 한 필드의 모든 변경 이력 (최신순).
 *
 * Fallback 로직:
 *   - changes 테이블이 없거나 (마이그레이션 미실행) 응답 0건이면
 *     kso_ops_context 에서 현재 값을 가져와 "현재 commit" entry 한 개를
 *     synthesize 해서 반환. UI 가 "이력 없음" 으로 빈 화면 안 보이게.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,50}$/;

interface HistoryEntry {
  id: string;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
  changed_by: string | null;
  changed_by_email: string | null;
  changed_by_name: string | null;
  synthesized?: boolean;
}

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

  // ── 1. kso_ops_context_changes 시도 ──
  let rows: Array<{
    id: string;
    old_value: unknown;
    new_value: unknown;
    changed_at: string;
    changed_by: string | null;
  }> = [];
  let tableMissing = false;
  try {
    const res = await sb
      .from("kso_ops_context_changes")
      .select("id, old_value, new_value, changed_at, changed_by")
      .eq("workspace_id", workspace)
      .eq("field_name", field)
      .order("changed_at", { ascending: false })
      .limit(50);
    if (res.error) {
      // 테이블 없음 등의 schema 에러는 fallback 으로 전환
      const msg = res.error.message ?? "";
      if (
        msg.includes("schema cache") ||
        msg.includes("does not exist") ||
        msg.includes("relation")
      ) {
        tableMissing = true;
      } else {
        return NextResponse.json(
          { ok: false, message: msg },
          { status: 500 },
        );
      }
    } else {
      rows = (res.data ?? []) as typeof rows;
    }
  } catch (e) {
    tableMissing = true;
    console.warn("history table query failed:", e);
  }

  // ── 2. Fallback: changes 가 비었으면 현재 commit 된 값을 synthesize ──
  if (rows.length === 0) {
    try {
      const { data: current } = await sb
        .from("kso_ops_context")
        .select("data, applied_at, applied_by")
        .eq("workspace_id", workspace)
        .maybeSingle();
      if (current) {
        const data = (current.data ?? {}) as Record<string, unknown>;
        const currentValue = data[field];
        if (currentValue !== undefined && currentValue !== null) {
          // 1건짜리 synthesized entry
          rows = [
            {
              id: `synth-${workspace}-${field}`,
              old_value: null,
              new_value: currentValue,
              changed_at:
                (current.applied_at as string | null) ??
                new Date().toISOString(),
              changed_by: (current.applied_by as string | null) ?? null,
            },
          ];
        }
      }
    } catch (e) {
      console.warn("fallback kso_ops_context query failed:", e);
    }
  }

  // ── 3. changed_by profile lookup (batch) ──
  const ids = Array.from(
    new Set(
      rows
        .map((r) => r.changed_by)
        .filter((v): v is string => v !== null),
    ),
  );
  const profileMap = new Map<
    string,
    { email: string | null; display_name: string | null }
  >();
  if (ids.length > 0) {
    try {
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
    } catch {}
  }

  const enriched: HistoryEntry[] = rows.map((r) => ({
    id: r.id,
    old_value: r.old_value,
    new_value: r.new_value,
    changed_at: r.changed_at,
    changed_by: r.changed_by,
    changed_by_email: r.changed_by
      ? profileMap.get(r.changed_by)?.email ?? null
      : null,
    changed_by_name: r.changed_by
      ? profileMap.get(r.changed_by)?.display_name ?? null
      : null,
    synthesized: r.id.startsWith("synth-"),
  }));

  return NextResponse.json({
    ok: true,
    history: enriched,
    table_missing: tableMissing,
  });
}

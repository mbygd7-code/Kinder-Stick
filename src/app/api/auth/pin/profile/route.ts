/**
 * PATCH /api/auth/pin/profile
 * body: { display_name?, team? }
 *
 * 자기 자신의 프로필 일부 필드 수정.
 * - role 변경은 여기서 불가 (관리자 라우트에서만)
 * - email 변경 불가 (영구 ID)
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { isValidTeam } from "@/lib/auth/pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  let body: { display_name?: string | null; team?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "잘못된 JSON" },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};

  if ("display_name" in body) {
    const dn = body.display_name?.toString().trim() ?? null;
    if (dn && dn.length > 40) {
      return NextResponse.json(
        { ok: false, message: "표시이름은 40자 이내" },
        { status: 400 },
      );
    }
    updates.display_name = dn || null;
  }

  if ("team" in body) {
    const team = body.team?.toString().trim() ?? null;
    if (team && !isValidTeam(team)) {
      return NextResponse.json(
        { ok: false, message: "팀 값이 올바르지 않습니다" },
        { status: 400 },
      );
    }
    updates.team = team || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("kso_profiles")
    .update(updates)
    .eq("id", me.id);
  if (error) {
    return NextResponse.json(
      { ok: false, message: `업데이트 실패: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, changed: Object.keys(updates).length });
}

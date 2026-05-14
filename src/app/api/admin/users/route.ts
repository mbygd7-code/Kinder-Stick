/**
 * GET /api/admin/users
 *
 * 관리자 전용 — 모든 kso_profiles 목록 (pin_hash 제외).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }
  if (me.role !== "admin") {
    return NextResponse.json(
      { ok: false, message: "관리자 권한이 필요합니다" },
      { status: 403 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("kso_profiles")
    .select(
      "id, email, role, team, display_name, created_at, last_login_at, locked_until",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, users: data ?? [] });
}

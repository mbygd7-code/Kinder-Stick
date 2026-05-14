/**
 * DELETE /api/auth/pin/account
 * body: { pin }   ← 본인 확인용
 *
 * 본인 계정 삭제. diagnosis_responses 의 profile_id 는 ON DELETE SET NULL.
 * 관리자가 1명뿐이면 거부.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import {
  isValidPin,
  verifyPin,
  SESSION_COOKIE,
} from "@/lib/auth/pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "잘못된 JSON" },
      { status: 400 },
    );
  }

  const pin = (body.pin ?? "").trim();
  if (!isValidPin(pin)) {
    return NextResponse.json(
      { ok: false, message: "본인 확인용 PIN 4자리 필요" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data: row } = await sb
    .from("kso_profiles")
    .select("pin_hash, role")
    .eq("id", me.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { ok: false, message: "프로필을 찾을 수 없습니다" },
      { status: 404 },
    );
  }
  if (!verifyPin(pin, row.pin_hash as string)) {
    return NextResponse.json(
      { ok: false, message: "PIN이 올바르지 않습니다" },
      { status: 401 },
    );
  }

  // 마지막 관리자 보호
  if (row.role === "admin") {
    const { count } = await sb
      .from("kso_profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "마지막 관리자이므로 삭제할 수 없습니다 — 다른 사람을 먼저 관리자로 승격하세요",
        },
        { status: 409 },
      );
    }
  }

  const { error } = await sb.from("kso_profiles").delete().eq("id", me.id);
  if (error) {
    return NextResponse.json(
      { ok: false, message: `삭제 실패: ${error.message}` },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

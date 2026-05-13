/**
 * POST /api/auth/pin/signup
 * body: { email, pin, team?, display_name?, role? }
 *
 * - 신규 kso_profiles row 생성
 * - 첫 사용자는 자동 admin (운영 편의)
 * - 성공 시 세션 쿠키 발급 → /me 로 이동 가능
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  hashPin,
  isValidPin,
  signSession,
  isValidTeam,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth/pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  let body: {
    email?: string;
    pin?: string;
    team?: string;
    display_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "잘못된 JSON" },
      { status: 400 },
    );
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const pin = (body.pin ?? "").trim();
  const team = body.team ? body.team.trim() : null;
  const display_name = body.display_name?.trim() || null;

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { ok: false, message: "이메일 형식이 올바르지 않습니다" },
      { status: 400 },
    );
  }
  if (!isValidPin(pin)) {
    return NextResponse.json(
      { ok: false, message: "PIN은 숫자 4자리여야 합니다" },
      { status: 400 },
    );
  }
  if (team && !isValidTeam(team)) {
    return NextResponse.json(
      { ok: false, message: "팀 값이 올바르지 않습니다" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // 중복 검사
  const { data: existing } = await sb
    .from("kso_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { ok: false, message: "이미 가입된 이메일입니다 — 로그인 화면을 이용하세요" },
      { status: 409 },
    );
  }

  // 첫 사용자는 자동 admin (운영 편의)
  const { count } = await sb
    .from("kso_profiles")
    .select("*", { count: "exact", head: true });
  const role: "admin" | "member" = (count ?? 0) === 0 ? "admin" : "member";

  const pin_hash = hashPin(pin);
  const { data: inserted, error } = await sb
    .from("kso_profiles")
    .insert({
      email,
      pin_hash,
      team: team || null,
      role,
      display_name,
      last_login_at: new Date().toISOString(),
    })
    .select("id, email, role, team")
    .single();
  if (error || !inserted) {
    return NextResponse.json(
      { ok: false, message: `가입 실패: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  const token = signSession({
    uid: inserted.id as string,
    email: inserted.email as string,
    role: inserted.role as "admin" | "member",
    team: (inserted.team as string | null) ?? null,
  });

  const res = NextResponse.json({
    ok: true,
    profile: {
      id: inserted.id,
      email: inserted.email,
      role: inserted.role,
      team: inserted.team,
    },
  });
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return res;
}

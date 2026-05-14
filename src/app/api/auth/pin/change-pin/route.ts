/**
 * POST /api/auth/pin/change-pin
 * body: { current_pin, new_pin }
 *
 * - current_pin 검증 후 new_pin 으로 교체
 * - 실패 카운터 영향 X (의도적 비밀번호 변경)
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { isValidPin, hashPin, verifyPin } from "@/lib/auth/pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  let body: { current_pin?: string; new_pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "잘못된 JSON" },
      { status: 400 },
    );
  }

  const currentPin = (body.current_pin ?? "").trim();
  const newPin = (body.new_pin ?? "").trim();

  if (!isValidPin(currentPin) || !isValidPin(newPin)) {
    return NextResponse.json(
      { ok: false, message: "PIN은 숫자 4자리여야 합니다" },
      { status: 400 },
    );
  }
  if (currentPin === newPin) {
    return NextResponse.json(
      { ok: false, message: "기존 PIN과 같습니다 — 다른 숫자로 설정하세요" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data: row } = await sb
    .from("kso_profiles")
    .select("pin_hash")
    .eq("id", me.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { ok: false, message: "프로필을 찾을 수 없습니다" },
      { status: 404 },
    );
  }
  if (!verifyPin(currentPin, row.pin_hash as string)) {
    return NextResponse.json(
      { ok: false, message: "기존 PIN이 올바르지 않습니다" },
      { status: 401 },
    );
  }

  const new_hash = hashPin(newPin);
  const { error } = await sb
    .from("kso_profiles")
    .update({ pin_hash: new_hash })
    .eq("id", me.id);
  if (error) {
    return NextResponse.json(
      { ok: false, message: `PIN 변경 실패: ${error.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

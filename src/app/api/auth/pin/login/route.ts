/**
 * POST /api/auth/pin/login
 * body: { email, pin }
 *
 * - 5회 실패 → 15분 잠금
 * - 성공 시 failed_attempts = 0, last_login_at 갱신, 쿠키 발급
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  isValidPin,
  verifyPin,
  signSession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth/pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function POST(req: Request) {
  let body: { email?: string; pin?: string };
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

  const sb = supabaseAdmin();
  const { data: row } = await sb
    .from("kso_profiles")
    .select(
      "id, email, pin_hash, role, team, failed_attempts, locked_until",
    )
    .eq("email", email)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { ok: false, message: "이메일 또는 PIN이 올바르지 않습니다" },
      { status: 401 },
    );
  }

  // 잠금 확인
  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
  if (lockedUntil && lockedUntil > new Date()) {
    const minutesLeft = Math.ceil(
      (lockedUntil.getTime() - Date.now()) / 60000,
    );
    return NextResponse.json(
      {
        ok: false,
        message: `너무 많은 실패 시도. ${minutesLeft}분 후 다시 시도하세요`,
      },
      { status: 429 },
    );
  }

  const ok = verifyPin(pin, row.pin_hash as string);
  if (!ok) {
    const attempts = ((row.failed_attempts as number) ?? 0) + 1;
    const updates: Record<string, unknown> = { failed_attempts: attempts };
    if (attempts >= MAX_ATTEMPTS) {
      updates.locked_until = new Date(
        Date.now() + LOCK_MINUTES * 60 * 1000,
      ).toISOString();
      updates.failed_attempts = 0; // 잠금 시 카운터 리셋
    }
    await sb.from("kso_profiles").update(updates).eq("id", row.id);
    return NextResponse.json(
      {
        ok: false,
        message:
          attempts >= MAX_ATTEMPTS
            ? `5회 실패 — ${LOCK_MINUTES}분간 잠금됩니다`
            : `이메일 또는 PIN이 올바르지 않습니다 (${MAX_ATTEMPTS - attempts}회 남음)`,
      },
      { status: 401 },
    );
  }

  // 성공
  await sb
    .from("kso_profiles")
    .update({
      failed_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  const token = signSession({
    uid: row.id as string,
    email: row.email as string,
    role: (row.role as "admin" | "member") ?? "member",
    team: (row.team as string | null) ?? null,
  });

  const res = NextResponse.json({
    ok: true,
    profile: {
      id: row.id,
      email: row.email,
      role: row.role,
      team: row.team,
    },
  });
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return res;
}

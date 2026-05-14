/**
 * POST /api/surveys/[token]/close
 *
 * 운영자가 설문을 종료.
 * - status='closed', closed_at=now
 * - 종료된 설문은 응답 받기 안 함
 * - 새 동일 kind 의 active 시작 가능해짐
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { isValidToken } from "@/lib/surveys/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  const { token } = await ctx.params;
  if (!isValidToken(token)) {
    return NextResponse.json(
      { ok: false, message: "잘못된 토큰" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data: survey } = await sb
    .from("kso_surveys")
    .select("id, status")
    .eq("share_token", token)
    .maybeSingle();
  if (!survey) {
    return NextResponse.json(
      { ok: false, message: "설문을 찾을 수 없습니다" },
      { status: 404 },
    );
  }
  if (survey.status === "closed") {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error } = await sb
    .from("kso_surveys")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", survey.id);
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

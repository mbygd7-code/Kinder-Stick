/**
 * POST /api/surveys/[token]/submit
 * body (NPS): { score: 0..10, reason?: string }
 * body (PMF): { pmf_choice: 1|2|3, reason?: string }
 *
 * - 익명 응답 (로그인 불필요)
 * - rate limit: 같은 (ip_hash, ua_hash) 가 1분 안에 3건 초과 시 429
 * - 토큰이 closed 또는 invalid 면 거부
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hashClient, isValidToken } from "@/lib/surveys/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 3;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!isValidToken(token)) {
    return NextResponse.json(
      { ok: false, message: "잘못된 토큰" },
      { status: 400 },
    );
  }

  let body: { score?: number; pmf_choice?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "잘못된 JSON" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // 1. 설문 조회 + status 확인
  const { data: survey } = await sb
    .from("kso_surveys")
    .select("id, kind, status")
    .eq("share_token", token)
    .maybeSingle();
  if (!survey) {
    return NextResponse.json(
      { ok: false, message: "설문을 찾을 수 없습니다" },
      { status: 404 },
    );
  }
  if (survey.status !== "active") {
    return NextResponse.json(
      { ok: false, message: "종료된 설문입니다" },
      { status: 410 },
    );
  }

  // 2. 응답 값 검증
  let score: number | null = null;
  let pmf_choice: number | null = null;
  if (survey.kind === "nps") {
    if (
      typeof body.score !== "number" ||
      !Number.isInteger(body.score) ||
      body.score < 0 ||
      body.score > 10
    ) {
      return NextResponse.json(
        { ok: false, message: "NPS score 는 0~10 정수여야 합니다" },
        { status: 400 },
      );
    }
    score = body.score;
  } else {
    if (
      typeof body.pmf_choice !== "number" ||
      ![1, 2, 3].includes(body.pmf_choice)
    ) {
      return NextResponse.json(
        { ok: false, message: "pmf_choice 는 1·2·3 중 하나" },
        { status: 400 },
      );
    }
    pmf_choice = body.pmf_choice;
  }

  // 3. IP/UA hash + rate limit
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const ua = req.headers.get("user-agent") ?? "unknown";
  const { ip_hash, ua_hash } = hashClient(ip, ua);

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await sb
    .from("kso_survey_responses")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ip_hash)
    .eq("ua_hash", ua_hash)
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_MAX) {
    return NextResponse.json(
      {
        ok: false,
        message: `짧은 시간에 너무 많은 응답입니다 — 1분 후 다시 시도하세요`,
      },
      { status: 429 },
    );
  }

  // 4. reason 검증·세니타이즈
  const reason =
    typeof body.reason === "string"
      ? body.reason.trim().slice(0, 500) || null
      : null;

  // 5. INSERT
  const { error } = await sb.from("kso_survey_responses").insert({
    survey_id: survey.id,
    score,
    pmf_choice,
    reason,
    ip_hash,
    ua_hash,
  });
  if (error) {
    return NextResponse.json(
      { ok: false, message: `저장 실패: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

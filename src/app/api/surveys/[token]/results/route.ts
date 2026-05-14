/**
 * GET /api/surveys/[token]/results
 *
 * 운영자만 호출 가능. 설문 결과 + 응답 목록 반환.
 *
 * 반환:
 *   {
 *     survey: { id, kind, title, question, status, created_at, closed_at, response_count },
 *     breakdown: { ... }  // NPS or PMF breakdown
 *     reasons: [{ created_at, score|pmf_choice, reason }, ...]   // text 응답만
 *   }
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { isValidToken } from "@/lib/surveys/token";
import { computeNps } from "@/lib/surveys/nps";
import { computePmf } from "@/lib/surveys/pmf";
import type { SurveyResponseRow } from "@/lib/surveys/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
    .select(
      "id, workspace_id, kind, title, question, status, created_at, closed_at",
    )
    .eq("share_token", token)
    .maybeSingle();
  if (!survey) {
    return NextResponse.json(
      { ok: false, message: "설문을 찾을 수 없습니다" },
      { status: 404 },
    );
  }

  const { data: resp } = await sb
    .from("kso_survey_responses")
    .select("id, score, pmf_choice, reason, created_at")
    .eq("survey_id", survey.id)
    .order("created_at", { ascending: false });
  const rows = (resp ?? []) as SurveyResponseRow[];

  const breakdown =
    survey.kind === "nps" ? computeNps(rows) : computePmf(rows);

  const reasons = rows
    .filter((r) => r.reason && r.reason.trim().length > 0)
    .slice(0, 100)
    .map((r) => ({
      created_at: r.created_at,
      score: r.score,
      pmf_choice: r.pmf_choice,
      reason: r.reason,
    }));

  return NextResponse.json({
    ok: true,
    survey: {
      ...survey,
      response_count: rows.length,
    },
    breakdown,
    reasons,
  });
}

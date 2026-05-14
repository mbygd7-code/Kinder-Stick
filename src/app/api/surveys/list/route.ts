/**
 * GET /api/surveys/list?workspace=<ws>
 *
 * 운영자 전용. workspace 의 모든 설문 (active + closed) 목록 + 각 설문의
 * 응답 수·점수·evidence 버킷 요약.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { computeNps, mapNpsToEvidence } from "@/lib/surveys/nps";
import { computePmf, mapPmfToEvidence } from "@/lib/surveys/pmf";
import {
  type SurveyRow,
  type SurveyResponseRow,
} from "@/lib/surveys/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

export async function GET(req: Request) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const workspace = url.searchParams.get("workspace") ?? "";
  if (!WS_PATTERN.test(workspace)) {
    return NextResponse.json(
      { ok: false, message: "workspace 파라미터 누락 또는 잘못됨" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data: surveys } = await sb
    .from("kso_surveys")
    .select(
      "id, kind, share_token, title, status, created_at, closed_at",
    )
    .eq("workspace_id", workspace)
    .order("created_at", { ascending: false });

  const rows: Array<{
    id: string;
    kind: "nps" | "pmf";
    share_token: string;
    title: string;
    status: "active" | "closed";
    created_at: string;
    closed_at: string | null;
    response_count: number;
    score_label: string | null;
    evidence_v: 1 | 2 | 3 | 4 | 5 | null;
    reliable: boolean;
  }> = [];

  for (const s of (surveys ?? []) as Pick<
    SurveyRow,
    "id" | "kind" | "share_token" | "title" | "status" | "created_at" | "closed_at"
  >[]) {
    const { data: resp } = await sb
      .from("kso_survey_responses")
      .select("score, pmf_choice")
      .eq("survey_id", s.id);
    const rs = (resp ?? []) as SurveyResponseRow[];
    if (s.kind === "nps") {
      const b = computeNps(rs);
      rows.push({
        ...s,
        response_count: b.total,
        score_label: b.total > 0 ? `NPS ${b.nps >= 0 ? "+" : ""}${b.nps}` : null,
        evidence_v: mapNpsToEvidence(b),
        reliable: b.reliable,
      });
    } else {
      const b = computePmf(rs);
      rows.push({
        ...s,
        response_count: b.total,
        score_label: b.total > 0 ? `VD ${b.vd_percent}%` : null,
        evidence_v: mapPmfToEvidence(b),
        reliable: b.reliable,
      });
    }
  }

  return NextResponse.json({ ok: true, surveys: rows });
}

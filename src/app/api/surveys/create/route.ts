/**
 * POST /api/surveys/create
 * body: { workspace_id, kind: "nps" | "pmf", title?, question?, reason_label? }
 *
 * 운영자만 호출 가능 (PIN auth 필요).
 * workspace 당 같은 kind 의 active 가 이미 있으면 409.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { generateShareToken } from "@/lib/surveys/token";
import {
  DEFAULT_QUESTION,
  DEFAULT_REASON_LABEL,
  DEFAULT_TITLE,
  type SurveyKind,
} from "@/lib/surveys/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

export async function POST(req: Request) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  let body: {
    workspace_id?: string;
    kind?: string;
    title?: string;
    question?: string;
    reason_label?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "잘못된 JSON" },
      { status: 400 },
    );
  }

  const workspace_id = (body.workspace_id ?? "").trim();
  if (!WS_PATTERN.test(workspace_id)) {
    return NextResponse.json(
      { ok: false, message: "workspace_id 형식 오류" },
      { status: 400 },
    );
  }
  if (body.kind !== "nps" && body.kind !== "pmf") {
    return NextResponse.json(
      { ok: false, message: "kind 는 nps 또는 pmf" },
      { status: 400 },
    );
  }
  const kind = body.kind as SurveyKind;

  const sb = supabaseAdmin();

  // active 중복 차단
  const { data: existing } = await sb
    .from("kso_surveys")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("kind", kind)
    .eq("status", "active")
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        ok: false,
        message: `이미 진행 중인 ${kind === "nps" ? "NPS" : "PMF"} 설문이 있습니다. 종료 후 다시 시작하세요.`,
      },
      { status: 409 },
    );
  }

  const title = (body.title?.trim() || DEFAULT_TITLE(kind)).slice(0, 100);
  const question = (
    body.question?.trim() || DEFAULT_QUESTION[kind]
  ).slice(0, 300);
  const reason_label = (
    body.reason_label?.trim() || DEFAULT_REASON_LABEL[kind]
  ).slice(0, 100);

  const share_token = generateShareToken();
  const { data: inserted, error } = await sb
    .from("kso_surveys")
    .insert({
      workspace_id,
      kind,
      share_token,
      title,
      question,
      reason_label,
      created_by: me.id,
      status: "active",
    })
    .select("id, share_token, kind, title, created_at")
    .single();
  if (error || !inserted) {
    return NextResponse.json(
      { ok: false, message: `생성 실패: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    survey: inserted,
    share_url: `/survey/${kind}/${share_token}`,
  });
}

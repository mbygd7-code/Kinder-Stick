/**
 * POST /api/admin/clone-diagnosis
 * body: { workspace_id, days_ago }
 *
 * Test-only — clones the latest diagnosis_response for `workspace_id`,
 * setting `completed_at` to (now - days_ago) and assigning a new respondent_num.
 * Used to seed historical quarters for /timeline verification.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(req: Request): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  return req.headers.get("x-admin-secret") === process.env.ADMIN_SECRET;
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: { workspace_id?: string; days_ago?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { workspace_id, days_ago } = body;
  if (!workspace_id || typeof days_ago !== "number") {
    return NextResponse.json(
      { ok: false, message: "workspace_id, days_ago 필요" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Find latest diagnosis to clone from
  const { data: latest, error: selErr } = await sb
    .from("diagnosis_responses")
    .select(
      "workspace_id, role, perspective, stage, responses, result, context",
    )
    .eq("workspace_id", workspace_id)
    .order("respondent_num", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selErr || !latest) {
    return NextResponse.json(
      { ok: false, message: `no source diagnosis: ${selErr?.message}` },
      { status: 404 },
    );
  }

  const { data: nextNum, error: rpcErr } = await sb.rpc(
    "next_respondent_num",
    { ws: workspace_id },
  );
  if (rpcErr) {
    return NextResponse.json(
      { ok: false, message: rpcErr.message },
      { status: 500 },
    );
  }

  const completed_at = new Date(
    Date.now() - days_ago * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: inserted, error: insErr } = await sb
    .from("diagnosis_responses")
    .insert({
      workspace_id,
      respondent_num: nextNum as number,
      role: latest.role ?? "synthesized",
      perspective: latest.perspective,
      stage: latest.stage,
      responses: latest.responses,
      result: latest.result,
      context: latest.context,
      completed_at,
    })
    .select("id, respondent_num, completed_at")
    .single();

  if (insErr) {
    return NextResponse.json(
      { ok: false, message: insErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    inserted,
    days_ago,
  });
}

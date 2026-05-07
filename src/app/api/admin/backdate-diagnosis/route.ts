/**
 * POST /api/admin/backdate-diagnosis
 * body: { workspace_id, days_ago }
 *
 * Test-only endpoint — sets the latest diagnosis_responses.completed_at to
 * (now - days_ago) days. Used for verifying quarterly-reminder cron flow
 * without waiting 90 real days.
 *
 * dev mode allows. production requires X-Admin-Secret.
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
  const newDate = new Date(
    Date.now() - days_ago * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Backdate ALL diagnosis_responses for this workspace
  const { data, error } = await sb
    .from("diagnosis_responses")
    .update({ completed_at: newDate })
    .eq("workspace_id", workspace_id)
    .select("id, respondent_num, completed_at");

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    workspace_id,
    new_completed_at: newDate,
    rows_updated: data?.length ?? 0,
    rows: data,
  });
}

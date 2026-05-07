/**
 * POST /api/admin/backdate-session
 * body: { session_id, days_ago }
 *
 * Test-only — sets agent_sessions.opened_at and all agent_messages.created_at
 * for the session to (now - days_ago). Used for verifying sessions-cleanup cron.
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

  let body: {
    session_id?: string;
    workspace_id?: string;
    trigger_kind?: string;
    days_ago?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { session_id, workspace_id, trigger_kind, days_ago } = body;
  if (typeof days_ago !== "number") {
    return NextResponse.json(
      { ok: false, message: "days_ago 필요" },
      { status: 400 },
    );
  }
  if (!session_id && !workspace_id) {
    return NextResponse.json(
      { ok: false, message: "session_id 또는 workspace_id 필요" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const newDate = new Date(
    Date.now() - days_ago * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Resolve target session_ids
  let sessionIds: string[];
  if (session_id) {
    sessionIds = [session_id];
  } else {
    const { data: org } = await sb
      .from("organizations")
      .select("id")
      .eq("name", workspace_id!)
      .maybeSingle();
    if (!org) {
      return NextResponse.json(
        { ok: false, message: `org not found for workspace ${workspace_id}` },
        { status: 404 },
      );
    }
    let q = sb
      .from("agent_sessions")
      .select("id")
      .eq("org_id", org.id)
      .not("state", "in", '("resolved","abandoned")');
    if (trigger_kind) q = q.eq("trigger_kind", trigger_kind);
    const { data: rows } = await q;
    sessionIds = (rows ?? []).map((r) => r.id as string);
  }

  if (sessionIds.length === 0) {
    return NextResponse.json({
      ok: true,
      sessions_updated: 0,
      messages_updated: 0,
      new_date: newDate,
      hint: "no matching sessions",
    });
  }

  const [{ data: ses, error: sErr }, { data: msgs, error: mErr }] =
    await Promise.all([
      sb
        .from("agent_sessions")
        .update({ opened_at: newDate })
        .in("id", sessionIds)
        .select("id, opened_at"),
      sb
        .from("agent_messages")
        .update({ created_at: newDate })
        .in("session_id", sessionIds)
        .select("id"),
    ]);

  if (sErr || mErr) {
    return NextResponse.json(
      { ok: false, message: sErr?.message ?? mErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    new_date: newDate,
    sessions_updated: ses?.length ?? 0,
    messages_updated: msgs?.length ?? 0,
    sessionIds,
  });
}

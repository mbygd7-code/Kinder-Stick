/**
 * POST /api/webhooks/meetflow/callback
 *
 * Real-mode callback receiver. Verifies HMAC signature against the request_id
 * stored in external_ai_calls, then persists the expert response as an
 * agent_message (role='external_expert') and updates the call row.
 *
 * Headers expected:
 *   x-hmac-signature: hex-encoded HMAC-SHA256 of raw body using
 *                    MEETFLOW_CALLBACK_HMAC_SECRET
 *
 * Body shape:
 *   {
 *     request_id: uuid,
 *     expert_finding: string,
 *     citations: [...],
 *     recommended_actions: [...],
 *     confidence: number,
 *     follow_up_questions: [...],
 *     cost_krw: number
 *   }
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyHmac } from "@/lib/agents/external-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CallbackBody {
  request_id?: string;
  expert_finding?: string;
  citations?: unknown[];
  recommended_actions?: unknown[];
  confidence?: number;
  follow_up_questions?: unknown[];
  cost_krw?: number;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hmac-signature") ?? "";

  if (!verifyHmac(rawBody, signature)) {
    return NextResponse.json(
      { ok: false, message: "HMAC verification failed" },
      { status: 401 },
    );
  }

  let body: CallbackBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON" },
      { status: 400 },
    );
  }

  if (!body.request_id) {
    return NextResponse.json(
      { ok: false, message: "request_id required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data: call } = await sb
    .from("external_ai_calls")
    .select("id, session_id, org_id, status")
    .eq("request_id", body.request_id)
    .maybeSingle();

  if (!call) {
    return NextResponse.json(
      { ok: false, message: "no matching external_ai_calls row" },
      { status: 404 },
    );
  }
  if (call.status === "responded" || call.status === "exposed") {
    return NextResponse.json({
      ok: true,
      already_processed: true,
    });
  }

  await sb.from("agent_messages").insert({
    session_id: call.session_id,
    role: "external_expert",
    content: {
      expert_finding: body.expert_finding,
      citations: body.citations ?? [],
      recommended_actions: body.recommended_actions ?? [],
      confidence: body.confidence ?? null,
      follow_up_questions: body.follow_up_questions ?? [],
      provider: "meetflow",
      request_id: body.request_id,
      cost_krw: body.cost_krw ?? null,
      _note: "Real Meetflow expert response — HMAC verified.",
    },
  });

  await sb
    .from("external_ai_calls")
    .update({
      status: "responded",
      hmac_verified: true,
      responded_at: new Date().toISOString(),
      response: body as unknown as Record<string, unknown>,
      cost_krw: body.cost_krw ?? null,
    })
    .eq("id", call.id);

  return NextResponse.json({ ok: true, processed: true });
}

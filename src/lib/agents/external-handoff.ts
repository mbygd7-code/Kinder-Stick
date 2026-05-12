/**
 * External handoff orchestrator.
 *
 * Flow:
 *  1. Build payload (question + context) from agent_session
 *  2. Redact PII via redactJson
 *  3. Insert external_ai_calls row (status='pending')
 *  4. Compute HMAC over payload + request_id
 *  5. Dispatch:
 *     - Real mode: POST to MEETFLOW_API_BASE/consultations
 *     - Mock mode: callMockExpert() with Claude specialist prompt (synchronous)
 *  6. Persist response as agent_message (role='external_expert') + update
 *     external_ai_calls (status='responded')
 */

import { createHmac, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactJson, type RedactionEntry } from "@/lib/pii";
import {
  callMockExpert,
  type ExpertDomain,
  type MockExpertOutput,
} from "./external-experts";

export interface HandoffArgs {
  sb: SupabaseClient;
  session_id: string;
  question: string;
  context: Record<string, unknown>;
  expert_domain: ExpertDomain;
  budget_krw?: number;
}

export interface HandoffResult {
  ok: boolean;
  request_id: string;
  external_call_id?: string;
  agent_message_id?: string;
  expert: MockExpertOutput | null;
  mock: boolean;
  redaction_entries: number;
  error?: string;
}

function meetflowConfigured(): boolean {
  return !!(
    process.env.MEETFLOW_API_BASE &&
    process.env.MEETFLOW_API_KEY &&
    process.env.MEETFLOW_CALLBACK_HMAC_SECRET
  );
}

function signHmac(payload: string): string {
  const secret = process.env.MEETFLOW_CALLBACK_HMAC_SECRET ?? "dev-mock-secret";
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyHmac(payload: string, signature: string): boolean {
  const expected = signHmac(payload);
  // constant-time compare
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function dispatchExternalHandoff(
  args: HandoffArgs,
): Promise<HandoffResult> {
  const { sb, session_id, question, context, expert_domain } = args;

  // 1) Verify session
  const { data: session } = await sb
    .from("agent_sessions")
    .select("id, org_id, domain_code")
    .eq("id", session_id)
    .single();
  if (!session) {
    return {
      ok: false,
      request_id: "",
      mock: !meetflowConfigured(),
      expert: null,
      redaction_entries: 0,
      error: "session not found",
    };
  }

  // 2) PII redaction
  const { value: redactedContext, entries: ctxEntries } = redactJson(context);
  const { value: redactedQ, entries: qEntries } = redactJson({ question });
  const totalEntries = ctxEntries.length + qEntries.length;

  const request_id = randomUUID();
  const payload = {
    request_id,
    callback_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/webhooks/meetflow/callback`,
    domain: expert_domain,
    question: (redactedQ as { question: string }).question,
    context: redactedContext,
    budget_krw: args.budget_krw ?? 200000,
    expected_format: "structured",
    deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const payloadStr = JSON.stringify(payload);
  const hmac = signHmac(payloadStr);

  // 3) Insert external_ai_calls (status='pending')
  const { data: callRow, error: callErr } = await sb
    .from("external_ai_calls")
    .insert({
      session_id,
      org_id: session.org_id,
      provider: meetflowConfigured() ? "meetflow" : "mock_expert",
      request_id,
      payload: { ...payload, _redaction_count: totalEntries },
      callback_secret_hmac: hmac,
      status: "pending",
      hmac_verified: false,
    })
    .select("id")
    .single();
  if (callErr || !callRow) {
    return {
      ok: false,
      request_id,
      mock: !meetflowConfigured(),
      expert: null,
      redaction_entries: totalEntries,
      error: `external_ai_calls INSERT 실패: ${callErr?.message}`,
    };
  }

  // 4) Dispatch
  let expert: MockExpertOutput | null = null;
  if (meetflowConfigured()) {
    // Real mode: POST and wait for async callback (don't block)
    try {
      const res = await fetch(
        `${process.env.MEETFLOW_API_BASE}/consultations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": process.env.MEETFLOW_API_KEY!,
            "x-hmac-signature": hmac,
          },
          body: payloadStr,
        },
      );
      if (!res.ok) {
        const text = await res.text();
        await sb
          .from("external_ai_calls")
          .update({
            status: "failed",
            response: { error: `${res.status}: ${text.slice(0, 300)}` },
          })
          .eq("id", callRow.id);
        return {
          ok: false,
          request_id,
          external_call_id: callRow.id,
          mock: false,
          expert: null,
          redaction_entries: totalEntries,
          error: `meetflow ${res.status}`,
        };
      }
      await sb
        .from("external_ai_calls")
        .update({
          status: "dispatched",
          dispatched_at: new Date().toISOString(),
        })
        .eq("id", callRow.id);
      // Real expert response will come via /api/webhooks/meetflow/callback
      return {
        ok: true,
        request_id,
        external_call_id: callRow.id,
        mock: false,
        expert: null,
        redaction_entries: totalEntries,
      };
    } catch (e) {
      await sb
        .from("external_ai_calls")
        .update({
          status: "failed",
          response: { error: e instanceof Error ? e.message : String(e) },
        })
        .eq("id", callRow.id);
      return {
        ok: false,
        request_id,
        external_call_id: callRow.id,
        mock: false,
        expert: null,
        redaction_entries: totalEntries,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // Mock mode: synchronous Claude call with specialist prompt
  try {
    expert = await callMockExpert({
      domain: expert_domain,
      redacted_question: (redactedQ as { question: string }).question,
      redacted_context: redactedContext as Record<string, unknown>,
      request_id,
    });
  } catch (e) {
    await sb
      .from("external_ai_calls")
      .update({
        status: "failed",
        response: { error: e instanceof Error ? e.message : String(e) },
      })
      .eq("id", callRow.id);
    return {
      ok: false,
      request_id,
      external_call_id: callRow.id,
      mock: true,
      expert: null,
      redaction_entries: totalEntries,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // 5) Persist external_expert message + update call row
  const { data: msgRow } = await sb
    .from("agent_messages")
    .insert({
      session_id,
      role: "external_expert",
      content: {
        expert_finding: expert.expert_finding,
        citations: expert.citations,
        recommended_actions: expert.recommended_actions,
        confidence: expert.confidence,
        follow_up_questions: expert.follow_up_questions,
        provider: "mock_expert",
        domain: expert_domain,
        request_id,
        cost_krw: expert.cost_krw,
        duration_ms: expert.duration_ms,
        _note: "Mock response — Meetflow API not configured. Sync Claude call.",
      },
      model: expert.model,
      tokens_in: 0,
      tokens_out: 0,
    })
    .select("id")
    .single();

  await sb
    .from("external_ai_calls")
    .update({
      status: "responded",
      dispatched_at: new Date().toISOString(),
      responded_at: new Date().toISOString(),
      response: expert as unknown as Record<string, unknown>,
      hmac_verified: true,
      cost_krw: expert.cost_krw,
    })
    .eq("id", callRow.id);

  // Move session state
  await sb
    .from("agent_sessions")
    .update({ state: "escalating_external" })
    .eq("id", session_id);

  return {
    ok: true,
    request_id,
    external_call_id: callRow.id,
    agent_message_id: msgRow?.id,
    mock: true,
    expert,
    redaction_entries: totalEntries,
  };
}

export function pickExpertDomain(
  domain_code: string,
): ExpertDomain | null {
  // Map kinder-stick domain codes to expert specializations
  switch (domain_code) {
    case "A7":
      return "regulatory_privacy";
    case "A11":
      return "specialized_legal"; // leadership / equity / governance
    case "A5":
      return "tax_accounting"; // unit econ / R&D credit
    default:
      return null;
  }
}

/**
 * POST /api/agent/external-handoff
 * body: { session_id, question?, expert_domain?, budget_krw? }
 *
 * Trigger an external AI consultation for a coaching session. Mock mode runs
 * synchronously (Claude specialist prompt). Real mode dispatches to Meetflow
 * and returns immediately; response arrives via /webhooks/meetflow/callback.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  dispatchExternalHandoff,
  pickExpertDomain,
} from "@/lib/agents/external-handoff";
import type { ExpertDomain } from "@/lib/agents/external-experts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DOMAINS: ExpertDomain[] = [
  "regulatory_privacy",
  "specialized_legal",
  "specialized_finance",
  "tax_accounting",
];

export async function POST(req: Request) {
  let body: {
    session_id?: string;
    question?: string;
    expert_domain?: string;
    budget_krw?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON" },
      { status: 400 },
    );
  }

  const { session_id, question, budget_krw } = body;
  if (!session_id) {
    return NextResponse.json(
      { ok: false, message: "session_id 필요" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Fetch session for context (org, domain, summary, latest agent message)
  const { data: session } = await sb
    .from("agent_sessions")
    .select("id, org_id, domain_code, summary, severity")
    .eq("id", session_id)
    .single();
  if (!session) {
    return NextResponse.json(
      { ok: false, message: "session not found" },
      { status: 404 },
    );
  }

  // Pick expert domain (override or derive)
  let expert_domain: ExpertDomain | null = null;
  if (body.expert_domain && VALID_DOMAINS.includes(body.expert_domain as ExpertDomain)) {
    expert_domain = body.expert_domain as ExpertDomain;
  } else {
    expert_domain = pickExpertDomain(session.domain_code);
  }
  if (!expert_domain) {
    return NextResponse.json(
      {
        ok: false,
        message: `domain ${session.domain_code} 에는 외부 전문가 매핑이 없습니다 (A5/A7/A11/A12 만 지원)`,
      },
      { status: 400 },
    );
  }

  // Build question + context
  // Pull latest agent message + a few user messages for context
  const { data: msgs } = await sb
    .from("agent_messages")
    .select("role, content, created_at")
    .eq("session_id", session_id)
    .order("created_at", { ascending: false })
    .limit(8);

  const latestAgent = (msgs ?? []).find((m) => m.role === "agent");
  const recentUserText = (msgs ?? [])
    .filter((m) => m.role === "user")
    .slice(0, 3)
    .map(
      (m) =>
        (m.content as { text?: string })?.text ?? JSON.stringify(m.content),
    )
    .join("\n---\n");

  const finalQuestion =
    question ??
    (latestAgent?.content as { finding?: string })?.finding ??
    session.summary ??
    `${session.domain_code} 도메인 외부 자문 요청`;

  const result = await dispatchExternalHandoff({
    sb,
    session_id,
    question: finalQuestion,
    context: {
      domain_code: session.domain_code,
      severity: session.severity,
      session_summary: session.summary,
      recent_user_messages: recentUserText,
      latest_agent_finding:
        (latestAgent?.content as { finding?: string })?.finding ?? null,
    },
    expert_domain,
    budget_krw,
  });

  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST { session_id, question?, expert_domain?, budget_krw? }. expert_domain ∈ regulatory_privacy / specialized_legal / specialized_finance / tax_accounting.",
  });
}

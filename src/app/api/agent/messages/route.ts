/**
 * POST /api/agent/messages
 * body: { session_id, user_message }
 *
 * Multi-turn 대화. 세션의 모든 messages를 history로 합쳐 Claude에 호출 →
 * 응답을 agent_messages에 추가. system prompt는 첫 system 메시지에서 재사용.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { anthropic } from "@/lib/anthropic";
import { fetchWorkspaceActions } from "@/lib/agents/actions-context";
import { formatActions } from "@/lib/agents/build-prompt";
import { buildSessionSystemPrompt } from "@/lib/agents/session-context";
import type { Stage } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AgentJsonReply {
  finding?: string;
  evidence?: Array<{ kind: string; source_id: string; summary: string }>;
  severity?: number;
  next_step?: { kind: string; prompt: string };
  confidence?: number;
  smart_actions?: Array<{
    owner: string;
    deadline_days: number;
    action: string;
    verification_metric?: string;
  }>;
  action_verifications?: Array<{
    action_id: string;
    new_status: string;
    measurement?: string;
    rationale?: string;
  }>;
}

interface VerificationResult {
  action_id: string;
  matched: boolean;
  applied: boolean;
  prev_status?: string;
  new_status?: string;
  reason?: string;
}

interface MessageRow {
  id: string;
  role: "system" | "user" | "agent" | "external_expert" | "tool_result";
  content: Record<string, unknown>;
  created_at: string;
}

export async function POST(req: Request) {
  let body: { session_id?: string; user_message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { session_id, user_message } = body;
  if (!session_id || typeof session_id !== "string") {
    return NextResponse.json(
      { ok: false, message: "session_id 필요" },
      { status: 400 },
    );
  }
  if (
    !user_message ||
    typeof user_message !== "string" ||
    user_message.trim().length === 0
  ) {
    return NextResponse.json(
      { ok: false, message: "user_message 필요" },
      { status: 400 },
    );
  }
  if (user_message.length > 4000) {
    return NextResponse.json(
      { ok: false, message: "user_message는 4000자 이하" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Validate session exists
  const { data: session, error: sErr } = await sb
    .from("agent_sessions")
    .select("id, state, domain_code, org_id")
    .eq("id", session_id)
    .single();

  if (sErr || !session) {
    return NextResponse.json(
      {
        ok: false,
        message: `session not found: ${sErr?.message ?? "unknown"}`,
      },
      { status: 404 },
    );
  }

  // Load full message history (chronological)
  const { data: history, error: hErr } = await sb
    .from("agent_messages")
    .select("id, role, content, created_at")
    .eq("session_id", session_id)
    .order("created_at", { ascending: true });

  if (hErr) {
    return NextResponse.json(
      { ok: false, message: `history load failed: ${hErr.message}` },
      { status: 500 },
    );
  }

  const rows = (history ?? []) as MessageRow[];
  const systemMsg = rows.find((r) => r.role === "system");
  if (!systemMsg) {
    return NextResponse.json(
      {
        ok: false,
        message: "session has no system message — start a new session",
      },
      { status: 500 },
    );
  }

  // Resolve workspace_id + stage from organization row (rebuild fresh prompt every turn)
  const { data: orgRow } = await sb
    .from("organizations")
    .select("name, stage")
    .eq("id", session.org_id)
    .single();
  const workspace_id = orgRow?.name ?? "unknown";
  const stage = (orgRow?.stage as Stage) ?? "seed";

  let systemBlocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>;
  try {
    const built = await buildSessionSystemPrompt({
      sb,
      org_id: session.org_id,
      workspace_id,
      domain_code: session.domain_code,
      stage,
    });
    // Split into cached static block + dynamic action-state block.
    // cache_control on the static block reuses prior cache (5 min TTL),
    // saving ~3500 tokens per turn after the first.
    systemBlocks = [
      {
        type: "text",
        text: built.systemPromptParts.cacheable,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: built.systemPromptParts.dynamic,
      },
    ];
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: `system prompt rebuild 실패: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 },
    );
  }

  // Persist user message first (raw, without action context prefix)
  await sb.from("agent_messages").insert({
    session_id,
    role: "user",
    content: { text: user_message } as Record<string, unknown>,
  });

  // Fetch live action state for this workspace — coach should be aware
  // of overdue/active actions even mid-conversation.
  const liveActions = await fetchWorkspaceActions(sb, session.org_id);
  const actionContext = formatActions(liveActions);

  // Build Claude messages: alternating user / assistant
  // Reconstruct from history excluding the system row
  const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];

  // First user turn — original user message that triggered the session
  const firstUserContent =
    typeof systemMsg.content?.user_message === "string"
      ? (systemMsg.content.user_message as string)
      : "도메인 진단을 시작합니다.";
  claudeMessages.push({ role: "user", content: firstUserContent });

  // Iterate non-system rows
  for (const r of rows) {
    if (r.role === "system") continue;
    if (r.role === "agent") {
      // Render agent JSON back as text (or raw)
      const text = renderAgentForHistory(r.content);
      claudeMessages.push({ role: "assistant", content: text });
    } else if (r.role === "user") {
      const text =
        typeof r.content?.text === "string"
          ? (r.content.text as string)
          : JSON.stringify(r.content);
      claudeMessages.push({ role: "user", content: text });
    }
  }
  // Add the new user_message at end with live action-state context prepended.
  // Coach gets fresh awareness of accepted/overdue actions every turn.
  const userMessageWithContext = [
    "[액션 보드 상태 — 자동 주입, 대화 컨텍스트로만 사용]",
    actionContext,
    "",
    "[사용자 메시지]",
    user_message,
  ].join("\n");
  claudeMessages.push({ role: "user", content: userMessageWithContext });

  // Ensure no two consecutive same-role messages (Claude requires alternation)
  const merged = mergeAlternating(claudeMessages);

  // Call Claude
  const model = "claude-sonnet-4-6";
  let agentRaw: string;
  let usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } = { input_tokens: 0, output_tokens: 0 };
  try {
    const resp = await anthropic().messages.create({
      model,
      max_tokens: 4000,
      temperature: 0.4,
      system: systemBlocks,
      messages: merged,
    });
    agentRaw = resp.content.reduce(
      (acc, b) => acc + (b.type === "text" ? b.text : ""),
      "",
    );
    const u = resp.usage as unknown as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    usage = {
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    };
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: `Claude API 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    );
  }

  const parsed = parseAgentReply(agentRaw);
  const validParse = !!parsed?.finding && !!parsed?.next_step;
  const newSeverity = clampInt(parsed?.severity, 1, 5, 3);
  const newState = inferState(parsed?.next_step?.kind, validParse);

  // Persist agent message
  const { data: inserted, error: insErr } = await sb
    .from("agent_messages")
    .insert({
      session_id,
      role: "agent",
      content: parsed
        ? (parsed as unknown as Record<string, unknown>)
        : { raw: agentRaw },
      model,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
    })
    .select("id, created_at")
    .single();

  if (insErr) {
    return NextResponse.json(
      {
        ok: false,
        message: `agent_messages INSERT 실패: ${insErr.message}`,
      },
      { status: 500 },
    );
  }

  // Update session state + severity (best-effort, ignore failure)
  await sb
    .from("agent_sessions")
    .update({
      state: newState,
      severity: newSeverity,
      summary: parsed?.finding ?? undefined,
    })
    .eq("id", session_id);

  // Apply action_verifications (coach-driven status transitions)
  let verificationResults: VerificationResult[] = [];
  if (parsed?.action_verifications && parsed.action_verifications.length > 0) {
    verificationResults = await applyActionVerifications(
      sb,
      session.org_id,
      parsed.action_verifications,
    );
  }

  return NextResponse.json({
    ok: true,
    message_id: inserted.id,
    created_at: inserted.created_at,
    state: newState,
    agent: parsed
      ? {
          finding: parsed.finding ?? null,
          severity: newSeverity,
          confidence: parsed.confidence ?? null,
          next_step: parsed.next_step ?? null,
          smart_actions: parsed.smart_actions ?? [],
          evidence: parsed.evidence ?? [],
          action_verifications: parsed.action_verifications ?? [],
        }
      : null,
    verification_results: verificationResults,
    raw: validParse ? null : agentRaw,
    usage,
  });
}

// ============================================================
// Action verification application
// ============================================================

const VALID_NEW_STATUS = new Set([
  "completed",
  "verified",
  "failed",
  "abandoned",
]);
const ALLOWED_PREV_STATUS = new Set(["accepted", "in_progress"]);

async function applyActionVerifications(
  sb: ReturnType<typeof supabaseAdmin>,
  orgId: string,
  verifications: NonNullable<AgentJsonReply["action_verifications"]>,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const v of verifications) {
    const prefix = (v.action_id ?? "").trim();
    if (!prefix || !v.new_status) {
      results.push({
        action_id: prefix,
        matched: false,
        applied: false,
        reason: "missing action_id or new_status",
      });
      continue;
    }
    if (!VALID_NEW_STATUS.has(v.new_status)) {
      results.push({
        action_id: prefix,
        matched: false,
        applied: false,
        reason: `invalid new_status: ${v.new_status}`,
      });
      continue;
    }

    // Match by id prefix within this org (UUID column doesn't support ilike,
    // so we fetch all org actions and prefix-match in JS)
    const { data: orgActions, error } = await sb
      .from("coaching_actions")
      .select("id, status, verification_metric, session_id")
      .eq("org_id", orgId);

    if (error) {
      results.push({
        action_id: prefix,
        matched: false,
        applied: false,
        reason: error.message,
      });
      continue;
    }

    const matches = (orgActions ?? []).filter((a) => a.id.startsWith(prefix));
    if (matches.length === 0) {
      results.push({
        action_id: prefix,
        matched: false,
        applied: false,
        reason: "no action matches this prefix in workspace",
      });
      continue;
    }
    if (matches.length > 1) {
      results.push({
        action_id: prefix,
        matched: false,
        applied: false,
        reason: "ambiguous prefix — multiple matches",
      });
      continue;
    }

    const action = matches[0];
    if (!ALLOWED_PREV_STATUS.has(action.status)) {
      results.push({
        action_id: prefix,
        matched: true,
        applied: false,
        prev_status: action.status,
        reason: `cannot transition from ${action.status}`,
      });
      continue;
    }

    const updates: Record<string, unknown> = {
      status: v.new_status,
      updated_at: new Date().toISOString(),
    };
    if (v.new_status === "verified") {
      updates.verified_at = new Date().toISOString();
    }
    if (v.measurement) {
      const existing =
        (action.verification_metric as Record<string, unknown> | null) ?? {};
      updates.verification_metric = {
        ...existing,
        measured: v.measurement,
        measured_at: new Date().toISOString(),
        rationale: v.rationale,
        applied_by: "agent",
      };
    }

    const { error: updErr } = await sb
      .from("coaching_actions")
      .update(updates)
      .eq("id", action.id);

    if (updErr) {
      results.push({
        action_id: prefix,
        matched: true,
        applied: false,
        prev_status: action.status,
        new_status: v.new_status,
        reason: updErr.message,
      });
      continue;
    }

    // Emit signal_event
    await sb.from("signal_events").insert({
      org_id: orgId,
      kind: "action_verified",
      domain_code: null,
      narrative: `${v.new_status.toUpperCase()} — 액션 #${prefix} (이전 ${action.status}). ${v.measurement ? `측정: ${String(v.measurement).slice(0, 120)}` : ""}`,
      severity: v.new_status === "verified" ? 1 : 2,
      metadata: {
        action_id: action.id,
        action_id_prefix: prefix,
        prev_status: action.status,
        new_status: v.new_status,
        applied_by: "agent",
      },
    });

    results.push({
      action_id: prefix,
      matched: true,
      applied: true,
      prev_status: action.status,
      new_status: v.new_status,
    });
  }

  return results;
}

// ============================================================
// Helpers
// ============================================================

function renderAgentForHistory(content: Record<string, unknown>): string {
  // Re-serialize agent JSON back to a compact form so Claude sees structured prior turns
  if (content?.raw) return String(content.raw);
  return JSON.stringify(content);
}

function parseAgentReply(raw: string): AgentJsonReply | null {
  try {
    return JSON.parse(raw);
  } catch {
    /* try fenced */
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* try brace */
    }
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* fall through */
    }
  }
  return null;
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function inferState(nextKind: string | undefined, valid: boolean): string {
  if (!valid) return "diagnosing";
  switch (nextKind) {
    case "diagnostic_question":
      return "diagnosing";
    case "evidence_request":
      return "evidence_request";
    case "action_proposal":
      return "action_planning";
    case "external_handoff":
      return "escalating_external";
    case "resolved":
      return "resolved";
    default:
      return "analyzing";
  }
}

function mergeAlternating(
  msgs: { role: "user" | "assistant"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      out.push({ ...m });
    }
  }
  // Claude requires first message to be user
  if (out[0]?.role !== "user") {
    out.unshift({ role: "user", content: "(시작)" });
  }
  return out;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "POST /api/agent/messages { session_id, user_message }",
  });
}

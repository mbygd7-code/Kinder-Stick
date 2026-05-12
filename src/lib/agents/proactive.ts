/**
 * Proactive coach trigger — when a signal_event fires (red KPI, overdue
 * action, quarterly_due, etc.), automatically prepare a coach finding so the
 * user sees a ready-to-act diagnosis when they next open the workspace.
 *
 * Idempotent — skips signals that already have processed_session_id in
 * metadata.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureWorkspaceOrg } from "@/lib/org";
import { anthropic } from "@/lib/anthropic";
import { buildSessionSystemPrompt } from "./session-context";
import type { Stage } from "@/lib/scoring";

interface ProactiveTriggerArgs {
  sb: SupabaseClient;
  signal_id: string;
  workspace_id: string;
  domain_code: string;
  signal_kind: string;
  signal_narrative: string;
  signal_severity: number;
  signal_metadata: Record<string, unknown>;
  stage?: Stage;
}

export interface ProactiveResult {
  signal_id: string;
  session_id: string | null;
  finding: string | null;
  applied: boolean;
  reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

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
}

export async function triggerProactiveCoach(
  args: ProactiveTriggerArgs,
): Promise<ProactiveResult> {
  const {
    sb,
    signal_id,
    workspace_id,
    domain_code,
    signal_kind,
    signal_narrative,
    signal_severity,
    signal_metadata,
    stage = "open_beta",
  } = args;

  // 1. Resolve org
  let org;
  try {
    org = await ensureWorkspaceOrg(sb, workspace_id, stage);
  } catch (e) {
    return {
      signal_id,
      session_id: null,
      finding: null,
      applied: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  // 2. Build system prompt (using shared builder)
  let built;
  try {
    built = await buildSessionSystemPrompt({
      sb,
      org_id: org.id,
      workspace_id,
      domain_code,
      stage,
    });
  } catch (e) {
    return {
      signal_id,
      session_id: null,
      finding: null,
      applied: false,
      reason: `system prompt build failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 3. Construct proactive user message
  const userMessage = [
    "[PROACTIVE TRIGGER — 자동 알림]",
    `방금 발생한 시그널을 진단해 주세요. 사용자가 워크스페이스에 들어오기 전에 미리 finding을 준비합니다.`,
    "",
    `signal kind: ${signal_kind}`,
    `severity: ${signal_severity}`,
    `narrative: ${signal_narrative}`,
    "",
    "metadata:",
    "```json",
    JSON.stringify(signal_metadata, null, 2),
    "```",
    "",
    "출력 가이드:",
    "- finding은 시그널의 '근본 원인 또는 즉시 조치 포인트'를 1문장.",
    "- evidence[]에 source_id='signal:" + signal_id.slice(0, 8) + "'(kind='kpi' or 'doc')로 시그널 자체를 인용.",
    "- next_step.kind는 일반적으로 'action_proposal' (긴급 조치) 또는 'diagnostic_question' (정보 부족 시).",
    "- smart_actions[] 1-2개로 압축 (3개 이상 금지 — 사용자가 즉시 채택 결정해야 함).",
    "- timeline·retrieved_actions가 관련 있으면 같이 인용.",
  ].join("\n");

  // 4. Call Claude
  const model = "claude-sonnet-4-6";
  let agentRaw = "";
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  try {
    const resp = await anthropic().messages.create({
      model,
      max_tokens: 3000,
      temperature: 0.2,
      system: [
        {
          type: "text",
          text: built.systemPromptParts.cacheable,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: built.systemPromptParts.dynamic },
      ],
      messages: [{ role: "user", content: userMessage }],
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
    return {
      signal_id,
      session_id: null,
      finding: null,
      applied: false,
      reason: `claude call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const parsed = parseAgentReply(agentRaw);
  const validParse = !!parsed?.finding && !!parsed?.next_step;
  const severity = clampInt(parsed?.severity, 1, 5, signal_severity);

  // 5. Insert agent_session + agent_messages
  const { data: session, error: sesErr } = await sb
    .from("agent_sessions")
    .insert({
      org_id: org.id,
      domain_code,
      state: validParse ? "action_planning" : "analyzing",
      severity,
      trigger_kind: "proactive",
      trigger_metadata: {
        signal_id,
        signal_kind,
        signal_narrative,
        proactive: true,
        ...signal_metadata,
      },
      matched_playbook_id: null,
      summary: parsed?.finding ?? null,
    })
    .select("id")
    .single();

  if (sesErr || !session) {
    return {
      signal_id,
      session_id: null,
      finding: null,
      applied: false,
      reason: `agent_sessions INSERT failed: ${sesErr?.message ?? "?"}`,
    };
  }

  await sb.from("agent_messages").insert([
    {
      session_id: session.id,
      role: "system",
      content: {
        system_prompt: built.systemPrompt,
        user_message: userMessage,
        proactive_trigger: { signal_id, signal_kind },
      } as Record<string, unknown>,
      model,
      tokens_in: 0,
      tokens_out: 0,
    },
    {
      session_id: session.id,
      role: "agent",
      content: parsed
        ? (parsed as unknown as Record<string, unknown>)
        : { raw: agentRaw },
      model,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
    },
  ]);

  // 6. Mark signal as processed (idempotency)
  await sb
    .from("signal_events")
    .update({
      metadata: {
        ...signal_metadata,
        processed_session_id: session.id,
        processed_at: new Date().toISOString(),
        processed_finding_excerpt: parsed?.finding?.slice(0, 200) ?? null,
      },
    })
    .eq("id", signal_id);

  return {
    signal_id,
    session_id: session.id,
    finding: parsed?.finding ?? null,
    applied: true,
    usage,
  };
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

function clampInt(
  v: unknown,
  lo: number,
  hi: number,
  fallback: number,
): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

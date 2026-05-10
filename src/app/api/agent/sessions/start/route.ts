/**
 * POST /api/agent/sessions/start
 * body: { workspace_id, domain_code }
 *
 * 1. workspace → organization upsert
 * 2. workspace의 모든 응답을 합산 → domain별 sub-item 응답 맵
 * 3. matched playbooks 추출
 * 4. system prompt + initial user message 빌드
 * 5. Claude API 호출 (one-shot, JSON 응답 기대)
 * 6. agent_sessions + agent_messages INSERT
 * 7. parsed result 반환
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureWorkspaceOrg } from "@/lib/org";
import { loadFramework } from "@/lib/framework/loader";
import { anthropic } from "@/lib/anthropic";
import {
  buildSystemPrompt,
  buildSystemPromptParts,
  buildInitialUserMessage,
  type RetrievedEvidence,
  type RetrievedAction,
} from "@/lib/agents/build-prompt";
import { fetchWorkspaceActions } from "@/lib/agents/actions-context";
import { matchPlaybooks } from "@/lib/agents/playbook-match";
import {
  computeSubItemScore,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
} from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const DOMAIN_PATTERN = /^A\d{1,2}$/;

interface DiagnosisRow {
  id: string;
  workspace_id: string;
  respondent_num: number;
  stage: string | null;
  responses: Record<
    string,
    {
      belief: number;
      evidence: number | null;
      na?: boolean;
      evidence_recorded_at: string;
    }
  > | null;
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

export async function POST(req: Request) {
  let body: { workspace_id?: string; domain_code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { workspace_id, domain_code } = body;
  if (!workspace_id || !WS_PATTERN.test(workspace_id)) {
    return NextResponse.json(
      { ok: false, message: "workspace_id가 유효하지 않습니다" },
      { status: 400 },
    );
  }
  if (!domain_code || !DOMAIN_PATTERN.test(domain_code)) {
    return NextResponse.json(
      { ok: false, message: "domain_code가 유효하지 않습니다 (예: A2)" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Pull diagnosis rows for this workspace
  const { data: rows, error: selErr } = await sb
    .from("diagnosis_responses")
    .select("id, workspace_id, respondent_num, stage, responses")
    .eq("workspace_id", workspace_id)
    .order("respondent_num", { ascending: true });

  if (selErr) {
    return NextResponse.json(
      { ok: false, message: `진단 응답 조회 실패: ${selErr.message}` },
      { status: 500 },
    );
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "이 workspace에는 아직 응답이 없습니다. 먼저 진단을 제출하세요.",
      },
      { status: 404 },
    );
  }

  const stage = ((rows[rows.length - 1] as DiagnosisRow).stage ?? "seed") as Stage;
  const org = await ensureWorkspaceOrg(sb, workspace_id, stage);

  // Load framework + domain
  const framework = loadFramework();
  const domain = framework.domains.find((d) => d.code === domain_code);
  if (!domain) {
    return NextResponse.json(
      { ok: false, message: `Unknown domain: ${domain_code}` },
      { status: 404 },
    );
  }

  // Aggregate sub-item responses (mean across respondents)
  const aggregated = aggregateDomainResponses(rows as DiagnosisRow[], domain);
  const retrievedEvidence: RetrievedEvidence[] = aggregated.evidence;

  // Match playbooks (use latest respondent's responses for trigger evaluation)
  const latestResponses = (rows[rows.length - 1] as DiagnosisRow).responses ?? {};
  const responseMap = Object.fromEntries(
    Object.entries(latestResponses).map(([k, v]) => [
      k,
      { evidence: v.evidence, na: v.na },
    ]),
  );
  const matched = matchPlaybooks(domain_code, responseMap);

  // Workspace의 채택된 액션 상태 — 코치가 follow-up 가능하도록
  const retrievedActions = await fetchWorkspaceActions(sb, org.id);

  // Build prompts (full + split for caching)
  const promptArgs = {
    domain,
    org: { workspace_id, stage },
    retrieved_kpi: [],
    retrieved_evidence: retrievedEvidence,
    matched_playbooks: matched,
    retrieved_actions: retrievedActions,
  };
  const systemPrompt = buildSystemPrompt(promptArgs);
  const systemPromptParts = buildSystemPromptParts(promptArgs);
  const userMessage = buildInitialUserMessage({
    domain,
    domain_score: aggregated.domain_score,
    red_critical:
      aggregated.domain_score !== null && aggregated.domain_score < domain.thresholds.red,
    retrieved_evidence: retrievedEvidence,
  });

  // Call Claude — split system into cacheable static + dynamic action state
  let agentRaw: string;
  let usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } = {
    input_tokens: 0,
    output_tokens: 0,
  };
  let model = "claude-sonnet-4-6";
  try {
    const resp = await anthropic().messages.create({
      model,
      max_tokens: 4000,
      temperature: 0.2,
      system: [
        {
          type: "text",
          text: systemPromptParts.cacheable,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: systemPromptParts.dynamic },
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
    return NextResponse.json(
      {
        ok: false,
        message: `Claude API 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    );
  }

  // Parse JSON
  const parsed = parseAgentReply(agentRaw);
  const severity = clampInt(parsed?.severity, 1, 5, 3);
  const validParse = !!parsed?.finding && !!parsed?.next_step;

  // Persist agent_sessions + agent_messages
  const { data: session, error: sesErr } = await sb
    .from("agent_sessions")
    .insert({
      org_id: org.id,
      domain_code,
      state: validParse ? "action_planning" : "diagnosing",
      severity,
      trigger_kind: "manual",
      trigger_metadata: {
        workspace_id,
        opened_from: "result_page",
        domain_score: aggregated.domain_score,
      },
      matched_playbook_id: matched[0]?.id ?? null,
      summary: parsed?.finding ?? null,
    })
    .select("id, state, opened_at")
    .single();

  if (sesErr || !session) {
    return NextResponse.json(
      {
        ok: false,
        message: `agent_sessions INSERT 실패: ${sesErr?.code ?? "?"}: ${sesErr?.message}`,
      },
      { status: 500 },
    );
  }

  // System message (audit)
  await sb.from("agent_messages").insert([
    {
      session_id: session.id,
      role: "system",
      content: { system_prompt: systemPrompt, user_message: userMessage } as Record<string, unknown>,
      model,
      tokens_in: 0,
      tokens_out: 0,
    },
    {
      session_id: session.id,
      role: "agent",
      content: (parsed ? (parsed as unknown as Record<string, unknown>) : { raw: agentRaw }),
      model,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
    },
  ]);

  return NextResponse.json({
    ok: true,
    session_id: session.id,
    state: session.state,
    opened_at: session.opened_at,
    domain: { code: domain.code, name_ko: domain.name_ko, name_en: domain.name_en },
    domain_score: aggregated.domain_score,
    matched_playbooks: matched,
    agent: {
      finding: parsed?.finding ?? null,
      severity,
      confidence: parsed?.confidence ?? null,
      next_step: parsed?.next_step ?? null,
      smart_actions: parsed?.smart_actions ?? [],
      evidence: parsed?.evidence ?? [],
    },
    raw: validParse ? null : agentRaw,
    usage,
  });
}

// ============================================================
// Helpers
// ============================================================

function aggregateDomainResponses(
  rows: DiagnosisRow[],
  domain: ReturnType<typeof loadFramework>["domains"][number],
) {
  const subDefs: SubItemDef[] = domain.groups.flatMap((g) =>
    g.sub_items.map((s) => ({
      code: s.code,
      domain: s.domain,
      group: s.group,
      tier: s.tier,
      weight_within_group: s.weight_within_group,
      data_quality_required: (s.data_quality_required ?? 1) as 1 | 2 | 3,
      reverse_scoring: s.reverse_scoring,
    })),
  );
  const subDefMap = new Map(subDefs.map((s) => [s.code, s]));
  const subItemMeta = new Map(
    domain.groups
      .flatMap((g) => g.sub_items)
      .map((s) => [s.code, { citation: s.citation }]),
  );

  // Collect all responses for sub-items in this domain
  const collected: SubItemResponse[] = [];
  for (const row of rows) {
    if (!row.responses) continue;
    for (const [code, r] of Object.entries(row.responses)) {
      if (!subDefMap.has(code)) continue;
      if (!r.belief) continue;
      collected.push({
        sub_item_code: code,
        respondent_id: `r${row.respondent_num}`,
        belief: r.belief as 1 | 2 | 3 | 4 | 5,
        evidence:
          r.na || r.evidence === null || r.evidence === undefined
            ? null
            : (r.evidence as 1 | 2 | 3 | 4 | 5),
        evidence_recorded_at: new Date(r.evidence_recorded_at),
      });
    }
  }

  const now = new Date();
  // Per-sub-item average across respondents
  const bySub = new Map<string, SubItemResponse[]>();
  for (const r of collected) {
    const arr = bySub.get(r.sub_item_code) ?? [];
    arr.push(r);
    bySub.set(r.sub_item_code, arr);
  }

  const evidence: RetrievedEvidence[] = [];
  const scores: number[] = [];
  for (const [code, list] of bySub.entries()) {
    const def = subDefMap.get(code)!;
    const meta = subItemMeta.get(code);
    const itemScores = list
      .map((r) => computeSubItemScore(r, def, now).score)
      .filter((s): s is number => s !== null);
    const avg =
      itemScores.length > 0
        ? itemScores.reduce((s, x) => s + x, 0) / itemScores.length
        : null;
    if (avg !== null) scores.push(avg);

    // Take the most recent response as representative
    const latest = list[list.length - 1];
    evidence.push({
      sub_item_code: code,
      belief: latest.belief,
      evidence: latest.evidence,
      na: latest.evidence === null,
      score: avg,
      citation: meta?.citation,
    });
  }

  const domain_score =
    scores.length === 0
      ? null
      : scores.reduce((s, x) => s + x, 0) / scores.length;

  return { domain_score, evidence };
}

function parseAgentReply(raw: string): AgentJsonReply | null {
  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }
  // Strip ```json fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }
  // Find first {...} block
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // ignore
    }
  }
  return null;
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "POST /api/agent/sessions/start { workspace_id, domain_code }",
  });
}

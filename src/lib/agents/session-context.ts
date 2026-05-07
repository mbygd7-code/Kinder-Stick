/**
 * Session context builder — shared between /api/agent/sessions/start and
 * /api/agent/messages so each turn rebuilds the system prompt with fresh
 * framework + workspace state. This avoids stale prompts when _base.md or
 * domain_coaches.md is updated mid-session.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFramework, type Domain } from "@/lib/framework/loader";
import {
  buildSystemPrompt,
  buildSystemPromptParts,
  type RetrievedEvidence,
  type PlaybookSummary,
  type SystemPromptParts,
} from "./build-prompt";
import { matchPlaybooks } from "./playbook-match";
import { fetchWorkspaceActions } from "./actions-context";
import { fetchWorkspaceTimeline } from "./timeline-context";
import {
  computeSubItemScore,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
} from "@/lib/scoring";

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

export interface BuiltSystemPromptResult {
  systemPrompt: string;
  systemPromptParts: SystemPromptParts;
  domain: Domain;
  domain_score: number | null;
  retrieved_evidence: RetrievedEvidence[];
  matched_playbooks: PlaybookSummary[];
  has_red_critical: boolean;
}

/**
 * Build a fresh system prompt for the given (org, workspace, domain).
 * Called per-turn so framework updates are picked up immediately.
 */
export async function buildSessionSystemPrompt(args: {
  sb: SupabaseClient;
  org_id: string;
  workspace_id: string;
  domain_code: string;
  stage?: Stage;
}): Promise<BuiltSystemPromptResult> {
  const { sb, org_id, workspace_id, domain_code } = args;

  const framework = loadFramework();
  const domain = framework.domains.find((d) => d.code === domain_code);
  if (!domain) {
    throw new Error(`Unknown domain: ${domain_code}`);
  }

  // Load all diagnosis responses for this workspace
  const { data: rows } = await sb
    .from("diagnosis_responses")
    .select("id, workspace_id, respondent_num, stage, responses")
    .eq("workspace_id", workspace_id)
    .order("respondent_num", { ascending: true });

  const diagnosisRows = (rows ?? []) as DiagnosisRow[];
  const stage =
    args.stage ??
    ((diagnosisRows[diagnosisRows.length - 1]?.stage as Stage) ?? "seed");

  const aggregated = aggregateDomainResponses(diagnosisRows, domain);

  // Match playbooks against the latest respondent's answers
  const latestResponses = diagnosisRows[diagnosisRows.length - 1]?.responses ?? {};
  const responseMap = Object.fromEntries(
    Object.entries(latestResponses).map(([k, v]) => [
      k,
      { evidence: v.evidence, na: v.na },
    ]),
  );
  const matched_playbooks = matchPlaybooks(domain_code, responseMap);

  // Live action state across the workspace
  const retrieved_actions = await fetchWorkspaceActions(sb, org_id);
  // Quarterly timeline (stable per session — part of cacheable prompt)
  const retrieved_timeline = await fetchWorkspaceTimeline(sb, workspace_id, 6);

  const promptArgs = {
    domain,
    org: { workspace_id, stage },
    retrieved_kpi: [],
    retrieved_evidence: aggregated.evidence,
    matched_playbooks,
    retrieved_actions,
    retrieved_timeline,
  };
  const systemPrompt = buildSystemPrompt(promptArgs);
  const systemPromptParts = buildSystemPromptParts(promptArgs);

  const has_red_critical =
    aggregated.domain_score !== null &&
    aggregated.domain_score < domain.thresholds.red;

  return {
    systemPrompt,
    systemPromptParts,
    domain,
    domain_score: aggregated.domain_score,
    retrieved_evidence: aggregated.evidence,
    matched_playbooks,
    has_red_critical,
  };
}

// ============================================================
// Aggregation (mirror of sessions/start)
// ============================================================

function aggregateDomainResponses(rows: DiagnosisRow[], domain: Domain) {
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

/**
 * Timeline context — aggregate diagnosis_responses by quarter and produce
 * a per-quarter snapshot used by the AI coach to reference progress/regression.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFramework } from "@/lib/framework/loader";
import {
  computeSubItemScore,
  computeGroupScore,
  computeDomainScore,
  computeOverallScore,
  computeFailureProbability,
  buildScoringConfig,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
  type GroupDef,
  type DomainScoreResult,
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
  completed_at: string;
}

export interface QuarterSnapshot {
  quarter_label: string;
  bucket_start: string;
  bucket_end: string;
  n_respondents: number;
  overall_score: number | null;
  domain_scores: Array<{
    code: string;
    score: number | null;
    tier_label: "red" | "yellow" | "green";
  }>;
  fp_6m: number;
  fp_12m: number;
  red_critical_codes: string[];
}

export function quarterLabel(d: Date): string {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

function quarterRange(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  const start = new Date(Date.UTC(y, q * 3, 1));
  const end = new Date(Date.UTC(y, q * 3 + 3, 0, 23, 59, 59));
  return { start, end };
}

/**
 * Load all diagnosis responses for a workspace and aggregate per quarter.
 * Returns chronologically sorted snapshots.
 */
export async function fetchWorkspaceTimeline(
  sb: SupabaseClient,
  workspace_id: string,
  limit_quarters = 6,
): Promise<QuarterSnapshot[]> {
  const { data, error } = await sb
    .from("diagnosis_responses")
    .select(
      "id, workspace_id, respondent_num, stage, responses, completed_at",
    )
    .eq("workspace_id", workspace_id)
    .order("completed_at", { ascending: true });

  if (error || !data || data.length === 0) return [];
  const rows = data as DiagnosisRow[];

  const framework = loadFramework();

  // Bucket by quarter
  const byQuarter = new Map<string, DiagnosisRow[]>();
  for (const r of rows) {
    const lbl = quarterLabel(new Date(r.completed_at));
    const arr = byQuarter.get(lbl) ?? [];
    arr.push(r);
    byQuarter.set(lbl, arr);
  }

  const labels = Array.from(byQuarter.keys()).sort();
  const tail = labels.slice(-limit_quarters);

  return tail.map((lbl) => {
    const grpRows = byQuarter.get(lbl)!;
    const range = quarterRange(new Date(grpRows[0].completed_at));
    const agg = aggregateQuarter(framework, grpRows);
    return {
      quarter_label: lbl,
      bucket_start: range.start.toISOString().slice(0, 10),
      bucket_end: range.end.toISOString().slice(0, 10),
      n_respondents: grpRows.length,
      overall_score: agg.overall,
      domain_scores: agg.domain_scores.map((d) => ({
        code: d.domain,
        score: d.score,
        tier_label: d.tier_label,
      })),
      fp_6m: agg.fp_6m,
      fp_12m: agg.fp_12m,
      red_critical_codes: agg.red_critical_codes,
    };
  });
}

function aggregateQuarter(
  framework: ReturnType<typeof loadFramework>,
  rows: DiagnosisRow[],
) {
  const subDefs: SubItemDef[] = framework.domains.flatMap((d) =>
    d.groups.flatMap((g) =>
      g.sub_items.map((s) => ({
        code: s.code,
        domain: s.domain,
        group: s.group,
        tier: s.tier,
        weight_within_group: s.weight_within_group,
        data_quality_required: (s.data_quality_required ?? 1) as 1 | 2 | 3,
        reverse_scoring: s.reverse_scoring,
      })),
    ),
  );
  const subDefMap = new Map(subDefs.map((s) => [s.code, s]));

  const responses: SubItemResponse[] = [];
  for (const row of rows) {
    if (!row.responses) continue;
    for (const [code, r] of Object.entries(row.responses)) {
      if (!subDefMap.has(code)) continue;
      if (!r.belief) continue;
      responses.push({
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

  const groupDefs: GroupDef[] = framework.domains.flatMap((d) => {
    const cnt = d.groups.length || 1;
    return d.groups.map((g) => ({
      code: g.code,
      domain: d.code,
      weight_within_domain: 1 / cnt,
      is_critical: g.sub_items.some((s) => s.tier === "critical"),
    }));
  });

  const subScoresPerRespondent = new Map<
    string,
    Map<string, ReturnType<typeof computeSubItemScore>>
  >();
  const now = new Date();
  for (const r of responses) {
    const def = subDefMap.get(r.sub_item_code);
    if (!def) continue;
    const score = computeSubItemScore(r, def, now);
    if (!subScoresPerRespondent.has(r.respondent_id)) {
      subScoresPerRespondent.set(r.respondent_id, new Map());
    }
    subScoresPerRespondent.get(r.respondent_id)!.set(r.sub_item_code, score);
  }

  const subScoreAvg = new Map<
    string,
    ReturnType<typeof computeSubItemScore>
  >();
  for (const def of subDefs) {
    const scores: number[] = [];
    for (const map of subScoresPerRespondent.values()) {
      const r = map.get(def.code);
      if (r && r.score !== null) scores.push(r.score);
    }
    if (scores.length === 0) continue;
    const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
    subScoreAvg.set(def.code, {
      score: mean,
      penalty: 0,
      belief_normalized: 0,
      evidence_normalized: null,
    });
  }

  const subDefsByGroup = new Map<string, SubItemDef[]>();
  for (const s of subDefs) {
    const list = subDefsByGroup.get(s.group);
    if (list) list.push(s);
    else subDefsByGroup.set(s.group, [s]);
  }

  const groupScoreMap = new Map<
    string,
    ReturnType<typeof computeGroupScore>
  >();
  for (const [code, defs] of subDefsByGroup.entries()) {
    const groupDef = groupDefs.find((g) => g.code === code);
    if (!groupDef) continue;
    groupScoreMap.set(code, computeGroupScore(groupDef, defs, subScoreAvg));
  }

  const domainDefs = framework.domains.map((d) => ({
    code: d.code,
    weight: d.weight,
    tier: d.tier,
  }));

  const domain_scores: DomainScoreResult[] = framework.domains.map((d) => {
    const responded = new Set(responses.map((r) => r.sub_item_code));
    const missingPenalty =
      d.groups
        .flatMap((g) => g.sub_items)
        .filter(
          (s) =>
            !responded.has(s.code) && (s.data_quality_required ?? 1) >= 2,
        ).length * -8;
    return computeDomainScore(
      { code: d.code, weight: d.weight, tier: d.tier },
      groupDefs.filter((g) => g.domain === d.code),
      groupScoreMap,
      missingPenalty,
      d.thresholds,
    );
  });

  const overall = computeOverallScore(domain_scores, domainDefs);
  const stage = (rows[rows.length - 1]?.stage as Stage) ?? "open_beta";
  const fp = computeFailureProbability(
    domain_scores,
    domainDefs,
    responses,
    stage,
    buildScoringConfig(framework),
    {
      subDefs,
      now,
      respondentCount: rows.length,
    },
  );

  const red_critical_codes = domain_scores
    .filter((d) => {
      const def = framework.domains.find((x) => x.code === d.domain);
      return (
        def?.tier === "critical" &&
        d.score !== null &&
        d.score < def.thresholds.red
      );
    })
    .map((d) => d.domain);

  return {
    overall,
    domain_scores,
    fp_6m: fp["6m"].final,
    fp_12m: fp["12m"].final,
    red_critical_codes,
  };
}

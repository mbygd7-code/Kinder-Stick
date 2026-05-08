/**
 * POST /api/diagnosis/submit
 *
 * 익명 진단 응답을 저장하고 점수를 계산해 반환한다.
 * v1 호환: diagnosis_responses (workspace_id 기반)에 저장.
 * v2 정규화 테이블 sub_item_responses는 인증된 organization 컨텍스트가
 * 있을 때만 별도 단계에서 채운다 (이후 phase).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureWorkspaceOrg } from "@/lib/org";
import { loadFramework } from "@/lib/framework/loader";
import {
  computeSubItemScore,
  computeGroupScore,
  computeDomainScore,
  computeOverallScore,
  computeFailureProbability,
  computeConsensus,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
  type GroupDef,
  type DomainDef,
} from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const VALID_STAGES = new Set<Stage>([
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c_plus",
]);

interface IncomingResponse {
  belief: number;
  evidence: number | null;
  na?: boolean;
  evidence_recorded_at: string;
}

interface IncomingPayload {
  workspace_id: string;
  context: {
    role?: string;
    perspective?: string;
    stage: Stage;
    team_size?: string;
  };
  responses: Record<string, IncomingResponse>;
}

export async function POST(req: Request) {
  let payload: IncomingPayload;
  try {
    payload = (await req.json()) as IncomingPayload;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // ---- Validate ----
  if (!payload.workspace_id || !WS_PATTERN.test(payload.workspace_id)) {
    return NextResponse.json(
      { ok: false, message: "workspace_id가 유효하지 않습니다" },
      { status: 400 },
    );
  }
  if (!payload.context || !VALID_STAGES.has(payload.context.stage)) {
    return NextResponse.json(
      { ok: false, message: "context.stage 값이 유효하지 않습니다" },
      { status: 400 },
    );
  }
  if (
    !payload.responses ||
    typeof payload.responses !== "object" ||
    Object.keys(payload.responses).length === 0
  ) {
    return NextResponse.json(
      { ok: false, message: "최소 1개 응답이 필요합니다" },
      { status: 400 },
    );
  }

  // ---- Compute scores ----
  const framework = loadFramework();
  const subItemMap = new Map(
    framework.domains
      .flatMap((d) => d.groups.flatMap((g) => g.sub_items))
      .map((s) => [s.code, s]),
  );

  const result = computeAllScores(framework, payload);

  // ---- Persist ----
  let sb;
  try {
    sb = supabaseAdmin();
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // 1. ensure organization row exists (idempotent)
  // 진단 제출과 동시에 org row를 생성해야 signals/actions/dashboard가 동작
  let orgId: string | null = null;
  try {
    const org = await ensureWorkspaceOrg(
      sb,
      payload.workspace_id,
      payload.context.stage,
    );
    orgId = org.id;
  } catch (e) {
    // best-effort — diagnosis 자체는 계속 저장
    console.error("ensureWorkspaceOrg failed:", e);
  }

  // 2. next respondent_num
  const { data: nextNumData, error: rpcErr } = await sb.rpc(
    "next_respondent_num",
    { ws: payload.workspace_id },
  );
  if (rpcErr) {
    return NextResponse.json(
      {
        ok: false,
        message: `next_respondent_num RPC 실패: ${rpcErr.message}`,
      },
      { status: 500 },
    );
  }
  const respondent_num = nextNumData as number;

  // 2. INSERT diagnosis_responses (v1 호환 + v2 컬럼)
  const session_id = crypto.randomUUID();
  const insertRow = {
    workspace_id: payload.workspace_id,
    respondent_num,
    role: payload.context.role ?? null,
    perspective: payload.context.perspective ?? null,
    stage: payload.context.stage,
    responses: payload.responses as unknown as Record<string, unknown>,
    result: result as unknown as Record<string, unknown>,
    session_id,
    context: payload.context as unknown as Record<string, unknown>,
  };

  const { data: inserted, error: insErr } = await sb
    .from("diagnosis_responses")
    .insert(insertRow)
    .select("id")
    .single();

  if (insErr) {
    return NextResponse.json(
      {
        ok: false,
        message: `diagnosis_responses INSERT 실패: ${insErr.code ?? "?"}: ${insErr.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    workspace_id: payload.workspace_id,
    respondent_num,
    session_id,
    n_responses: Object.keys(payload.responses).length,
    sub_items_known: Array.from(subItemMap.keys()).length,
    result,
  });
}

// ============================================================
// Scoring orchestration (단일 응답자 기준)
// ============================================================

function computeAllScores(
  framework: ReturnType<typeof loadFramework>,
  payload: IncomingPayload,
) {
  const now = new Date();
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

  // Collect responses with valid mappings
  const subResponses: SubItemResponse[] = [];
  for (const [code, r] of Object.entries(payload.responses)) {
    if (!subDefMap.has(code)) continue;
    if (!r.belief || r.belief < 1 || r.belief > 5) continue;
    const evidence =
      r.na || r.evidence === null || r.evidence === undefined
        ? null
        : (r.evidence as 1 | 2 | 3 | 4 | 5);
    subResponses.push({
      sub_item_code: code,
      respondent_id: "anon-1",
      belief: r.belief as 1 | 2 | 3 | 4 | 5,
      evidence,
      evidence_recorded_at: new Date(r.evidence_recorded_at),
    });
  }

  // Compute sub-item scores
  const subScoreMap = new Map<
    string,
    ReturnType<typeof computeSubItemScore>
  >();
  for (const r of subResponses) {
    const def = subDefMap.get(r.sub_item_code);
    if (!def) continue;
    subScoreMap.set(r.sub_item_code, computeSubItemScore(r, def, now));
  }

  // Group definitions (synthesized from framework)
  const groupDefs: GroupDef[] = framework.domains.flatMap((d) => {
    const groupCount = d.groups.length || 1;
    return d.groups.map((g) => {
      const hasCritical = g.sub_items.some((s) => s.tier === "critical");
      return {
        code: g.code,
        domain: d.code,
        weight_within_domain: 1 / groupCount,
        is_critical: hasCritical,
      };
    });
  });
  const groupDefMap = new Map(groupDefs.map((g) => [g.code, g]));

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
    const groupDef = groupDefMap.get(code);
    if (!groupDef) continue;
    groupScoreMap.set(code, computeGroupScore(groupDef, defs, subScoreMap));
  }

  // Domain definitions
  const domainDefs: DomainDef[] = framework.domains.map((d) => ({
    code: d.code,
    weight: d.weight,
    tier: d.tier,
  }));
  const domainScores = framework.domains.map((d) => {
    // missing penalty: each missing sub_item with dq_req >= 2 contributes -8
    const responded = new Set(subResponses.map((r) => r.sub_item_code));
    const missingPenalty =
      d.groups
        .flatMap((g) => g.sub_items)
        .filter(
          (s) =>
            !responded.has(s.code) && (s.data_quality_required ?? 1) >= 2,
        ).length * -8;

    const dGroups = groupDefs.filter((g) => g.domain === d.code);
    return computeDomainScore(
      { code: d.code, weight: d.weight, tier: d.tier },
      dGroups,
      groupScoreMap,
      missingPenalty,
      d.thresholds,
    );
  });

  const overall = computeOverallScore(domainScores, domainDefs);

  // Failure probability (no critical_caps wired yet — will add in phase 2)
  const fp = computeFailureProbability(
    domainScores,
    domainDefs,
    subResponses,
    payload.context.stage,
  );

  // Consensus is meaningful only with multiple respondents.
  // Single-respondent submission omits CI; aggregation happens in result page.
  return {
    overall_score: overall,
    domain_scores: domainScores.map((d) => ({
      code: d.domain,
      score: d.score,
      tier_label: d.tier_label,
      capped: d.capped,
      missing_penalty: d.missing_penalty,
    })),
    group_scores: Array.from(groupScoreMap.values()).map((g) => ({
      code: g.group,
      score: g.score,
      capped: g.capped,
      n_subs: g.n_subs,
      n_missing: g.n_missing,
    })),
    sub_item_scores: Array.from(subScoreMap.entries()).map(([code, r]) => ({
      code,
      score: r.score,
      flag: r.flag,
    })),
    failure_probability: fp,
    n_responses: subResponses.length,
    computed_at: now.toISOString(),
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST /api/diagnosis/submit { workspace_id, context, responses } 로 호출하세요",
  });
}

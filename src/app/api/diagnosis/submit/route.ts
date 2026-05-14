/**
 * POST /api/diagnosis/submit
 *
 * 익명 진단 응답을 저장하고 점수를 계산해 반환한다.
 * v1 호환: diagnosis_responses (workspace_id 기반)에 저장.
 * v2 정규화 테이블 sub_item_responses는 인증된 organization 컨텍스트가
 * 있을 때만 별도 단계에서 채운다 (이후 phase).
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureWorkspaceOrg } from "@/lib/org";
import { loadFramework } from "@/lib/framework/loader";
import { getCurrentProfile } from "@/lib/auth/session";
import {
  computeSubItemScore,
  computeGroupScore,
  computeDomainScore,
  computeOverallScore,
  computeFailureProbability,
  computeConsensus,
  buildScoringConfig,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
  type GroupDef,
  type DomainDef,
} from "@/lib/scoring";
import type { DiagnosisProfile } from "@/lib/diagnosis-profile/types";
import {
  applyWeightMultipliers,
  buildAddedSubDefs,
  computeMissingPenaltyForDomain,
} from "@/lib/diagnosis-profile/apply-scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const VALID_STAGES = new Set<Stage>([
  "closed_beta",
  "open_beta",
  "ga_early",
  "ga_growth",
  "ga_scale",
]);

/**
 * 레거시 VC 펀딩 단계 값을 새 출시 단계로 매핑.
 * 기존 클라이언트 (oldschool DB row, localStorage) 에서 들어온 값을 호환.
 */
const LEGACY_STAGE_MAP: Record<string, Stage> = {
  pre_seed: "closed_beta",
  seed: "open_beta",
  series_a: "ga_early",
  series_b: "ga_growth",
  series_c_plus: "ga_scale",
};

function normalizeStage(input: unknown): Stage | null {
  if (typeof input !== "string") return null;
  if (VALID_STAGES.has(input as Stage)) return input as Stage;
  const mapped = LEGACY_STAGE_MAP[input];
  return mapped ?? null;
}

interface IncomingEvidenceFile {
  url: string;
  name: string;
  size: number;
  mime: string;
  uploaded_at: string;
}

interface IncomingAIAnalysis {
  summary: string;
  suggested_bucket: number | null;
  confidence: number;
  flags: string[];
  analyzed_at: string;
  model: string;
}

interface IncomingResponse {
  belief: number;
  evidence: number | null;
  na?: boolean;
  evidence_recorded_at: string;

  // ── Evidence-based diagnosis 확장 ──
  actual_value?: string;
  notes?: string;
  evidence_files?: IncomingEvidenceFile[];
  ai_analysis?: IncomingAIAnalysis;
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
  /**
   * 운영 컨텍스트 기반 진단 적응 프로필 (T1 가중치 + T2 참고정보 +
   * T3 추가 카드 + inactive). 없으면 기본 frame 그대로 점수 산출.
   */
  applied_profile?: DiagnosisProfile;
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
  if (!payload.context) {
    return NextResponse.json(
      { ok: false, message: "context 가 누락되었습니다" },
      { status: 400 },
    );
  }
  const normalizedStage = normalizeStage(payload.context.stage);
  if (!normalizedStage) {
    return NextResponse.json(
      { ok: false, message: "context.stage 값이 유효하지 않습니다" },
      { status: 400 },
    );
  }
  // Normalize for downstream code (handles legacy values transparently)
  payload.context.stage = normalizedStage;
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

  // 2. INSERT diagnosis_responses (v1 호환 + v2 컬럼 + PIN-auth team tag)
  const session_id = crypto.randomUUID();

  // 커스텀 PIN 세션이 있으면 응답자 정체성을 태그.
  // - admin: respondent_team = 'admin' (모든 팀 응답 가능 의미)
  // - member: respondent_team = profile.team ?? null
  // 익명 응답 (PIN 미로그인) 은 둘 다 null
  const me = await getCurrentProfile().catch(() => null);
  const respondent_profile_id = me?.id ?? null;
  const respondent_team = me
    ? me.role === "admin"
      ? "admin"
      : (me.team ?? null)
    : null;

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
    respondent_profile_id,
    respondent_team,
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

  // 새 진단 제출 후 워크스페이스 목록·홈·결과 페이지 캐시 무효화 (best-effort)
  try {
    revalidatePath("/diag");
    revalidatePath(`/diag/${payload.workspace_id}`);
    revalidatePath(`/diag/${payload.workspace_id}/home`);
    revalidatePath(`/diag/${payload.workspace_id}/result`);
  } catch {
    // ignore
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
  const profile = payload.applied_profile ?? null;

  // 기본 frame sub-items
  const baseSubDefs: SubItemDef[] = framework.domains.flatMap((d) =>
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
  // T3 추가 카드의 SubItemDef 도 합쳐 점수 산출 대상에 포함
  const addedSubDefs: SubItemDef[] = profile
    ? buildAddedSubDefs(profile.added_sub_items)
    : [];
  const subDefs: SubItemDef[] = [...baseSubDefs, ...addedSubDefs];
  const subDefMap = new Map(subDefs.map((s) => [s.code, s]));

  // Collect responses with valid mappings.
  // AI suggested_bucket (confidence ≥ 0.6) 이 있고 사용자가 선택한 bucket 과
  // 격차가 1 이상이면, evidence 점수 계산에 AI bucket 을 우선 사용 (조작 방지).
  const subResponses: SubItemResponse[] = [];
  for (const [code, r] of Object.entries(payload.responses)) {
    if (!subDefMap.has(code)) continue;
    if (!r.belief || r.belief < 1 || r.belief > 5) continue;

    // 사용자가 선택한 bucket
    const userEvidence =
      r.na || r.evidence === null || r.evidence === undefined
        ? null
        : (r.evidence as 1 | 2 | 3 | 4 | 5);

    // AI 추론 bucket 적용 규칙:
    // - na 가 아니고 (실측·노트·파일 중 하나라도 있고)
    // - AI 신뢰도 ≥ 0.6
    // - AI suggested_bucket 이 1-5 범위
    // 인 경우, AI bucket 을 evidence 로 사용 (자가 평가 조작 방어)
    let evidence: 1 | 2 | 3 | 4 | 5 | null = userEvidence;
    if (
      !r.na &&
      r.ai_analysis &&
      r.ai_analysis.confidence >= 0.6 &&
      typeof r.ai_analysis.suggested_bucket === "number" &&
      r.ai_analysis.suggested_bucket >= 1 &&
      r.ai_analysis.suggested_bucket <= 5
    ) {
      evidence = r.ai_analysis.suggested_bucket as 1 | 2 | 3 | 4 | 5;
    }

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
  // 추가 카드의 group 이 존재하면 도메인 내 weight 재배분 (기본 + custom 균등)
  const addedGroupsByDomain = new Map<string, SubItemDef[]>();
  for (const a of addedSubDefs) {
    const list = addedGroupsByDomain.get(a.domain);
    if (list) list.push(a);
    else addedGroupsByDomain.set(a.domain, [a]);
  }
  const groupDefs: GroupDef[] = framework.domains.flatMap((d) => {
    const hasCustom = addedGroupsByDomain.has(d.code);
    const totalGroups = d.groups.length + (hasCustom ? 1 : 0) || 1;
    const baseGroups: GroupDef[] = d.groups.map((g) => ({
      code: g.code,
      domain: d.code,
      weight_within_domain: 1 / totalGroups,
      is_critical: g.sub_items.some((s) => s.tier === "critical"),
    }));
    if (hasCustom) {
      const customSubs = addedGroupsByDomain.get(d.code)!;
      baseGroups.push({
        code: `${d.code}.CUSTOM`,
        domain: d.code,
        weight_within_domain: 1 / totalGroups,
        is_critical: customSubs.some((s) => s.tier === "critical"),
      });
    }
    return baseGroups;
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

  // Domain definitions — T1 weight multipliers 적용
  const baseDomainDefs: DomainDef[] = framework.domains.map((d) => ({
    code: d.code,
    weight: d.weight,
    tier: d.tier,
  }));
  const domainDefs: DomainDef[] = applyWeightMultipliers(
    baseDomainDefs,
    profile,
  );
  const domainDefByCode = new Map(domainDefs.map((d) => [d.code, d]));
  const responded = new Set(subResponses.map((r) => r.sub_item_code));

  const domainScores = framework.domains.map((d) => {
    // missing penalty: 비활성 sub-item 은 면제 (apply-scoring 헬퍼)
    const missingPenalty = computeMissingPenaltyForDomain(
      d.code,
      framework,
      responded,
      profile,
    );
    const dGroups = groupDefs.filter((g) => g.domain === d.code);
    const def = domainDefByCode.get(d.code) ?? {
      code: d.code,
      weight: d.weight,
      tier: d.tier,
    };
    return computeDomainScore(def, dGroups, groupScoreMap, missingPenalty, d.thresholds);
  });

  const overall = computeOverallScore(domainScores, domainDefs);

  // YAML SoT 의 priors·LRs·critical_caps 를 ScoringConfig 로 빌드해 주입 (H-1.1, H-1.2)
  const fp = computeFailureProbability(
    domainScores,
    domainDefs,
    subResponses,
    payload.context.stage,
    buildScoringConfig(framework),
    {
      subDefs,
      now,
      respondentCount: 1, // 단일 응답자 제출 시점
    },
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
    // Audit trail: 점수 산정에 적용된 적응 프로필 (T1/T2/T3/inactive).
    // 분기 비교 시 "이 분기의 적응이 무엇이었나" 추적 가능.
    applied_profile: profile,
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

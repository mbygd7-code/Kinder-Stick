/**
 * GET /api/diagnosis/list?workspace=...
 *
 * 워크스페이스의 이전 진단 응답 목록 (메타 정보만) 반환.
 * 통합 진단 페이지 (D) 이전 진단 이력 섹션이 사용.
 *
 * 응답: 각 진단의 id, respondent_num, role, stage, completed_at, overall_score
 *
 * 한 응답이 곧 하나의 진단 세션 (응답자 1명 단위).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

interface DiagRow {
  id: string;
  respondent_num: number;
  role: string | null;
  perspective: string | null;
  stage: string | null;
  completed_at: string;
  result: Record<string, unknown> | null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace = url.searchParams.get("workspace") ?? "";

  if (!WS_PATTERN.test(workspace)) {
    return NextResponse.json(
      { ok: false, message: "invalid workspace" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("diagnosis_responses")
    .select("id, respondent_num, role, perspective, stage, completed_at, result")
    .eq("workspace_id", workspace)
    .order("completed_at", { ascending: false })
    .limit(40);

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as DiagRow[];

  // 결과에서 overall_score 추출 (안전하게)
  const items = rows.map((r) => {
    const result = (r.result ?? {}) as {
      overall_score?: number;
      red_critical_count?: number;
      failure_probability?: {
        "6m"?: { final?: number };
        "12m"?: { final?: number };
      };
    };
    return {
      id: r.id,
      respondent_num: r.respondent_num,
      role: r.role,
      perspective: r.perspective,
      stage: r.stage,
      completed_at: r.completed_at,
      overall_score:
        typeof result.overall_score === "number"
          ? Math.round(result.overall_score)
          : null,
      red_critical_count:
        typeof result.red_critical_count === "number"
          ? result.red_critical_count
          : null,
      fp_6m:
        typeof result.failure_probability?.["6m"]?.final === "number"
          ? Math.round(result.failure_probability["6m"].final * 100)
          : null,
      fp_12m:
        typeof result.failure_probability?.["12m"]?.final === "number"
          ? Math.round(result.failure_probability["12m"].final * 100)
          : null,
    };
  });

  return NextResponse.json({
    ok: true,
    workspace,
    count: items.length,
    items,
  });
}

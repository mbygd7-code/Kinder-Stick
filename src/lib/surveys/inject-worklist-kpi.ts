/**
 * 워크리스트 KPI 충족 evidence 를 진단에 주입 (3-tier 모델 Phase 3).
 *
 * /api/worklist/kpi-evidence 가 sub_item_responses 에 data_source='worklist_kpi_verified'
 * 로 기록한 항목들을 읽어 aggregateRespondents 에 SubItemResponse[] 로 흘려보낸다.
 *
 * 신선도 가중치는 기존 computeSubItemScore 의 time decay 로직이 evidence_recorded_at
 * 기반으로 이미 처리 (≤90d full, ≤180d decay, >180d stale flag).
 *
 * 정책:
 *  - data_source='user' 와 같은 sub_item_code 가 있으면 kpi-evidence 라우트에서
 *    이미 필터링 — 여기서는 단순히 읽어서 변환만.
 *  - belief 값이 없으므로 evidence_value 를 belief 로도 사용 (consensus 평균에 들어감).
 */

import type { SubItemResponse } from "@/lib/scoring";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";

interface KpiEvidenceRow {
  sub_item_code: string;
  respondent_id: string;
  evidence_value: number;
  evidence_recorded_at: string;
}

export async function injectWorklistKpiResults(
  workspace: string,
): Promise<SubItemResponse[]> {
  try {
    const sb = supabaseAdmin();
    const org = await resolveOrgWithBackfill(sb, workspace);
    if (!org) return [];

    const { data } = await sb
      .from("sub_item_responses")
      .select("sub_item_code, respondent_id, evidence_value, evidence_recorded_at")
      .eq("org_id", org.id)
      .eq("data_source", "worklist_kpi_verified");

    const rows = (data ?? []) as KpiEvidenceRow[];
    return rows.map((r) => {
      const v = Math.max(1, Math.min(5, Math.round(r.evidence_value))) as
        | 1
        | 2
        | 3
        | 4
        | 5;
      return {
        sub_item_code: r.sub_item_code,
        respondent_id: r.respondent_id,
        // belief: 미체크 KPI 는 evidence_value=2 (낮은 신뢰), 체크는 4 (높은 신뢰)
        // belief 는 진단 응답이 없으므로 evidence 와 동일한 신호로 사용.
        belief: v,
        evidence: v,
        evidence_recorded_at: new Date(r.evidence_recorded_at),
      };
    });
  } catch {
    return [];
  }
}

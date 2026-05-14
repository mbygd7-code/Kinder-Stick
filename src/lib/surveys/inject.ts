/**
 * Active 설문 결과를 진단 응답에 read-time 으로 주입.
 *
 * - 30+ 응답 모인 active 설문이 있으면 점수 계산
 * - 5단계 evidence 버킷으로 매핑 후 SubItemResponse[] 반환
 * - `diagnosis-aggregate.ts:aggregateRespondents()` 가 이 결과를 기존 응답 배열에
 *   합친다 (DB write X — pure read).
 *
 * 운영자가 진단 폼에서 수동 입력한 응답이 있으면 진단 폼 응답이 후순위 합산되므로
 * 가중평균에 함께 들어감 (덮어쓰기 X). 진단 폼이 수동 override 를 표시할 때는
 * `getActiveSurveysSummary()` 의 결과를 별도로 보여줌.
 */

import type { SubItemResponse } from "@/lib/scoring";
import { supabaseAdmin } from "@/lib/supabase/server";
import { computeNps, mapNpsToEvidence } from "./nps";
import { computePmf, mapPmfToEvidence } from "./pmf";
import {
  SURVEY_SUB_ITEM_CODE,
  STALE_DAYS,
  type SurveyRow,
  type SurveyResponseRow,
  type SurveyKind,
} from "./types";

export interface ActiveSurveySummary {
  kind: SurveyKind;
  survey_id: string;
  sub_item_code: string;
  response_count: number;
  reliable: boolean;
  score_label: string; // "NPS +18" 또는 "VD 38%"
  evidence_v: 1 | 2 | 3 | 4 | 5 | null;
  stale: boolean;
  created_at: string;
}

/**
 * Active 설문들의 요약. 진단 폼 UI 가 "자동 측정 중" 배지 그리는 데 사용.
 */
export async function getActiveSurveysSummary(
  workspace_id: string,
): Promise<ActiveSurveySummary[]> {
  const sb = supabaseAdmin();
  const { data: surveys } = await sb
    .from("kso_surveys")
    .select(
      "id, kind, share_token, title, status, created_at, workspace_id",
    )
    .eq("workspace_id", workspace_id)
    .eq("status", "active");
  if (!surveys || surveys.length === 0) return [];

  const summaries: ActiveSurveySummary[] = [];
  for (const s of surveys as SurveyRow[]) {
    const { data: resp } = await sb
      .from("kso_survey_responses")
      .select("score, pmf_choice")
      .eq("survey_id", s.id);
    const rows = (resp ?? []) as SurveyResponseRow[];

    const ageDays =
      (Date.now() - new Date(s.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const stale = ageDays > STALE_DAYS;

    if (s.kind === "nps") {
      const b = computeNps(rows);
      summaries.push({
        kind: "nps",
        survey_id: s.id,
        sub_item_code: SURVEY_SUB_ITEM_CODE.nps,
        response_count: b.total,
        reliable: b.reliable,
        score_label: `NPS ${b.nps >= 0 ? "+" : ""}${b.nps}`,
        evidence_v: mapNpsToEvidence(b),
        stale,
        created_at: s.created_at,
      });
    } else {
      const b = computePmf(rows);
      summaries.push({
        kind: "pmf",
        survey_id: s.id,
        sub_item_code: SURVEY_SUB_ITEM_CODE.pmf,
        response_count: b.total,
        reliable: b.reliable,
        score_label: `VD ${b.vd_percent}%`,
        evidence_v: mapPmfToEvidence(b),
        stale,
        created_at: s.created_at,
      });
    }
  }
  return summaries;
}

/**
 * Active 설문에서 30+ 응답이 모인 것만 SubItemResponse 형태로 변환해
 * 진단 응답 합산에 끼워 넣음.
 */
export async function injectActiveSurveyResults(
  workspace_id: string,
): Promise<SubItemResponse[]> {
  const summaries = await getActiveSurveysSummary(workspace_id);
  const out: SubItemResponse[] = [];
  for (const s of summaries) {
    if (s.evidence_v === null) continue; // 응답 부족 — 보류
    out.push({
      sub_item_code: s.sub_item_code,
      respondent_id: `survey-${s.kind}-${s.survey_id.slice(0, 8)}`,
      belief: 3 as 1 | 2 | 3 | 4 | 5, // belief 중립 (자동 측정이라 운영자 인식과 별개)
      evidence: s.evidence_v,
      evidence_recorded_at: new Date(s.created_at),
    });
  }
  return out;
}

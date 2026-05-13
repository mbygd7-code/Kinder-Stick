/**
 * KPI 메트릭 → sub_item_responses 자동 동기화 (C6).
 *
 * 흐름:
 *   1. 외부 KPI 텍스트 분석으로 추출된 메트릭(source.metric_key, value) 배열을 받음
 *   2. metric_definitions 테이블에서 (source, metric_key) → sub_item_code 매핑 조회
 *   3. threshold_rule 에 따라 value → bucket 1-5 변환
 *   4. sub_item_responses upsert (data_source='kpi_derive_auto', evidence_value=bucket)
 *   5. kpi_snapshots 에도 raw 값 저장
 *
 * 호출자:
 *   - /api/worklist/derive (KPI 텍스트 인입)
 *   - /api/admin/inject-kpi (이미 자체 구현 중)
 *
 * 안전장치:
 *   - bucket 미정의 메트릭은 무시 (silent)
 *   - confidence < 0.5 메트릭은 무시
 *   - sub_item_responses 의 data_source 가 다른 값이면 덮어쓰지 않음 (사용자 입력 우선)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ParsedMetric {
  source: string;        // "ga4" | "mixpanel" | "admin" ...
  metric_key: string;    // "d1_activation_rate" | "wau" ...
  value: number;         // raw 측정값 (예: 0.38, 12345)
  confidence: number;    // 0..1 — AI 가 텍스트에서 추출한 신뢰도
  captured_at?: string;  // ISO, 없으면 현재 시각
}

interface MetricDefinitionRow {
  source: string;
  metric_key: string;
  mapped_sub_item_code: string | null;
  threshold_rule:
    | {
        bands?: Array<{ max?: number; min?: number; v: number }>;
      }
    | null;
}

interface SyncResult {
  matched: number;
  upserted: number;
  skipped: number;
  reasons: Record<string, number>;
}

const DEFAULT_BUCKET = 3; // 매핑 실패 시 사용하는 중립값 (저장 안 함)

/**
 * 메트릭 배열을 받아 매핑 가능한 것만 sub_item_responses + kpi_snapshots 에 upsert.
 *
 * @param sb       — service-role Supabase client
 * @param orgId    — 워크스페이스 organization id
 * @param metrics  — AI 가 추출한 메트릭 목록
 * @returns 처리 결과 통계
 */
export async function syncMetricsToSubItems(
  sb: SupabaseClient,
  orgId: string,
  metrics: ParsedMetric[],
): Promise<SyncResult> {
  const result: SyncResult = {
    matched: 0,
    upserted: 0,
    skipped: 0,
    reasons: {},
  };

  if (metrics.length === 0) return result;

  // 1) metric_definitions 일괄 조회 (org 별로 정의된 것만)
  const { data: defs } = await sb
    .from("metric_definitions")
    .select("source, metric_key, mapped_sub_item_code, threshold_rule")
    .eq("org_id", orgId)
    .eq("active", true);
  const defMap = new Map<string, MetricDefinitionRow>(
    ((defs ?? []) as MetricDefinitionRow[]).map((d) => [
      `${d.source}.${d.metric_key}`,
      d,
    ]),
  );

  const now = new Date().toISOString();
  const respondentId = "kpi-auto";

  for (const m of metrics) {
    // 신뢰도 필터
    if (m.confidence < 0.5) {
      result.skipped += 1;
      result.reasons["low_confidence"] =
        (result.reasons["low_confidence"] ?? 0) + 1;
      continue;
    }

    const key = `${m.source}.${m.metric_key}`;
    const def = defMap.get(key);
    if (!def || !def.mapped_sub_item_code) {
      result.skipped += 1;
      result.reasons["no_mapping"] = (result.reasons["no_mapping"] ?? 0) + 1;
      continue;
    }
    result.matched += 1;

    // 2) threshold_rule 로 bucket 산출
    const bucket = computeBucket(m.value, def.threshold_rule);
    if (bucket === null) {
      result.skipped += 1;
      result.reasons["bucket_undefined"] =
        (result.reasons["bucket_undefined"] ?? 0) + 1;
      continue;
    }

    const capturedAt = m.captured_at ?? now;

    // 3) 사용자 자가 응답(data_source='user') 이 같은 sub_item 에 있으면 자동 덮어쓰지 않음.
    //    별도 respondent_id 로 격리되므로 자동 데이터는 'kpi-auto' 슬롯에만 저장.
    //    user 의 응답 존재 여부를 확인해 자동 응답 자체를 스킵 (조작 방지).
    const { data: userResp } = await sb
      .from("sub_item_responses")
      .select("id")
      .eq("org_id", orgId)
      .eq("sub_item_code", def.mapped_sub_item_code)
      .eq("data_source", "user")
      .maybeSingle();
    if (userResp) {
      result.skipped += 1;
      result.reasons["user_response_priority"] =
        (result.reasons["user_response_priority"] ?? 0) + 1;
      continue;
    }

    // 4) 단일 atomic upsert — race condition 제거.
    //    onConflict = (org_id, sub_item_code, respondent_id) 의 unique 제약 기준.
    const { error: upsertErr } = await sb.from("sub_item_responses").upsert(
      {
        org_id: orgId,
        respondent_id: respondentId,
        sub_item_code: def.mapped_sub_item_code,
        evidence_value: bucket,
        evidence_recorded_at: capturedAt,
        data_source: "kpi_derive_auto",
      },
      {
        onConflict: "org_id,sub_item_code,respondent_id",
        ignoreDuplicates: false,
      },
    );
    if (upsertErr) {
      result.skipped += 1;
      result.reasons[`upsert_error:${upsertErr.code ?? "?"}`] =
        (result.reasons[`upsert_error:${upsertErr.code ?? "?"}`] ?? 0) + 1;
      continue;
    }

    // 4) kpi_snapshots 에도 raw value 기록 (history)
    await sb.from("kpi_snapshots").insert({
      org_id: orgId,
      source: m.source,
      metric_key: m.metric_key,
      value: m.value,
      captured_at: capturedAt,
      raw: { mapped_sub_item: def.mapped_sub_item_code, bucket } as Record<
        string,
        unknown
      >,
    });

    result.upserted += 1;
  }

  return result;
}

/**
 * threshold_rule 기반으로 value → bucket 변환.
 * bands 배열 형식: [{ max: 0.15, v: 1 }, { max: 0.25, v: 2 }, ...]
 * 매칭되는 band 없으면 마지막 band 의 v 또는 null 반환.
 */
function computeBucket(
  value: number,
  rule: MetricDefinitionRow["threshold_rule"],
): number | null {
  if (!rule || !rule.bands || rule.bands.length === 0) return null;
  for (const band of rule.bands) {
    if (band.max !== undefined && value < band.max) return band.v;
    if (band.min !== undefined && value >= band.min) return band.v;
  }
  // 마지막 fallback
  const last = rule.bands[rule.bands.length - 1];
  return last.v ?? DEFAULT_BUCKET;
}

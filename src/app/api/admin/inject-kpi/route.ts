/**
 * POST /api/admin/inject-kpi
 * body: { workspace_id, source, metric_key, value, captured_at? }
 *
 * Mock KPI injector. 실제 외부 통합 (Stripe/GA4/etc.) 자리에 사람 손으로
 * 값을 넣어 파이프라인을 검증하기 위한 endpoint.
 *
 * 흐름:
 *  1. workspace → org upsert
 *  2. metric_definitions에서 (source, metric_key) 조회 → mapped_sub_item_code 확보
 *  3. transform 적용해 evidence.v 도출 + severity 판정
 *  4. kpi_snapshots INSERT (raw value + anomaly_flag)
 *  5. signal_events INSERT (사람이 읽을 narrative)
 *
 * Phase 4에서 sub_item_responses 자동 갱신을 추가할 예정 (지금은 KPI 시그널만).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureWorkspaceOrg } from "@/lib/org";
import type { Stage } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InjectBody {
  workspace_id: string;
  source: string;
  metric_key: string;
  value: number;
  captured_at?: string;
}

interface Bucket {
  v: 1 | 2 | 3 | 4 | 5;
  severity: "red" | "amber" | "green";
  label: string;
}

const TRANSFORMS: Record<string, (value: number) => Bucket> = {
  "ga4:d1_activation_rate": (v) => {
    if (v < 0.2) return { v: 1, severity: "red", label: "D1 < 20% — 활성화 결손" };
    if (v < 0.35) return { v: 2, severity: "amber", label: "D1 20-34% — 주의" };
    if (v < 0.5) return { v: 3, severity: "amber", label: "D1 35-49%" };
    if (v < 0.65) return { v: 4, severity: "green", label: "D1 50-64%" };
    return { v: 5, severity: "green", label: "D1 ≥ 65%" };
  },
  "mixpanel:m3_retention_rate": (v) => {
    if (v < 0.15) return { v: 1, severity: "red", label: "M3 < 15% — 가짜 PMF" };
    if (v < 0.3) return { v: 2, severity: "red", label: "M3 15-29%" };
    if (v < 0.45) return { v: 3, severity: "amber", label: "M3 30-44%" };
    if (v < 0.6) return { v: 4, severity: "green", label: "M3 45-59%" };
    return { v: 5, severity: "green", label: "M3 ≥ 60%" };
  },
  "channeltalk:nps": (v) => {
    if (v < 0) return { v: 1, severity: "red", label: "NPS 음수 — 디트랙터 우세" };
    if (v < 20) return { v: 2, severity: "amber", label: "NPS 0-19" };
    if (v < 40) return { v: 3, severity: "amber", label: "NPS 20-39" };
    if (v < 60) return { v: 4, severity: "green", label: "NPS 40-59" };
    return { v: 5, severity: "green", label: "NPS ≥ 60" };
  },
};

export async function POST(req: Request) {
  let body: InjectBody;
  try {
    body = (await req.json()) as InjectBody;
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { workspace_id, source, metric_key } = body;
  if (!workspace_id || !source || !metric_key) {
    return NextResponse.json(
      {
        ok: false,
        message: "workspace_id, source, metric_key 필요",
      },
      { status: 400 },
    );
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return NextResponse.json(
      { ok: false, message: "value 는 숫자여야 합니다" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Look up metric definition
  const { data: def, error: defErr } = await sb
    .from("metric_definitions")
    .select(
      "id, source, metric_key, mapped_sub_item_code, threshold_rule, cadence",
    )
    .eq("source", source)
    .eq("metric_key", metric_key)
    .eq("active", true)
    .maybeSingle();

  if (defErr) {
    return NextResponse.json(
      { ok: false, message: `metric_definitions 조회 실패: ${defErr.message}` },
      { status: 500 },
    );
  }
  if (!def) {
    return NextResponse.json(
      {
        ok: false,
        message: `매핑되지 않은 metric: ${source}:${metric_key}. 먼저 /api/admin/seed 를 호출하세요.`,
      },
      { status: 404 },
    );
  }

  // Resolve org
  const stage: Stage = "open_beta";
  const org = await ensureWorkspaceOrg(sb, workspace_id, stage);

  // Apply transform
  const transformKey = `${source}:${metric_key}`;
  const transform = TRANSFORMS[transformKey];
  if (!transform) {
    return NextResponse.json(
      {
        ok: false,
        message: `transform 미구현: ${transformKey}`,
      },
      { status: 501 },
    );
  }
  const bucket = transform(body.value);
  const anomalyFlag = bucket.severity === "red";

  const capturedAt = body.captured_at ?? new Date().toISOString();

  // Insert kpi_snapshot
  const { data: snap, error: snapErr } = await sb
    .from("kpi_snapshots")
    .insert({
      org_id: org.id,
      source,
      metric_key,
      value: body.value,
      captured_at: capturedAt,
      raw: {
        injected: true,
        bucket,
        mapped_sub_item: def.mapped_sub_item_code,
        threshold_rule: def.threshold_rule,
      },
      anomaly_flag: anomalyFlag,
      anomaly_reason: anomalyFlag ? bucket.label : null,
    })
    .select("id, captured_at")
    .single();

  if (snapErr) {
    return NextResponse.json(
      {
        ok: false,
        message: `kpi_snapshots INSERT 실패: ${snapErr.code ?? "?"}: ${snapErr.message}`,
      },
      { status: 500 },
    );
  }

  // Insert signal_event
  const narrative = formatNarrative({
    source,
    metric_key,
    value: body.value,
    sub_item: def.mapped_sub_item_code,
    bucket,
  });
  const domainCode = def.mapped_sub_item_code?.split(".")[0] ?? null;

  await sb.from("signal_events").insert({
    org_id: org.id,
    kind: "kpi_anomaly",
    domain_code: domainCode,
    narrative,
    severity: bucket.severity === "red" ? 4 : bucket.severity === "amber" ? 3 : 2,
    metadata: {
      source,
      metric_key,
      value: body.value,
      bucket,
      sub_item: def.mapped_sub_item_code,
      kpi_snapshot_id: snap.id,
    },
  });

  return NextResponse.json({
    ok: true,
    kpi_snapshot_id: snap.id,
    captured_at: snap.captured_at,
    mapped_sub_item: def.mapped_sub_item_code,
    bucket,
    anomaly_flag: anomalyFlag,
    narrative,
    org_id: org.id,
  });
}

function formatNarrative({
  source,
  metric_key,
  value,
  sub_item,
  bucket,
}: {
  source: string;
  metric_key: string;
  value: number;
  sub_item: string | null;
  bucket: Bucket;
}): string {
  const valStr = formatValue(source, metric_key, value);
  return `${source}.${metric_key} = ${valStr} → ${sub_item ?? "?"} ${bucket.severity.toUpperCase()} (evidence.v=${bucket.v}, ${bucket.label})`;
}

function formatValue(source: string, metric_key: string, value: number): string {
  const key = `${source}:${metric_key}`;
  switch (key) {
    case "ga4:d1_activation_rate":
    case "mixpanel:m3_retention_rate":
      return `${(value * 100).toFixed(1)}%`;
    case "channeltalk:nps":
      return value.toFixed(0);
    default:
      return String(value);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST { workspace_id, source, metric_key, value }. 매핑된 sources: ga4.d1_activation_rate, mixpanel.m3_retention_rate, channeltalk.nps",
  });
}

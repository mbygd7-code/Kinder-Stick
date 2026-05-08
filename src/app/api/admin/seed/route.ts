/**
 * POST /api/admin/seed
 *
 * Seeds Supabase tables `domain_definitions` and `sub_items` from
 * framework/question_bank.yaml. Idempotent (uses upsert on primary key).
 *
 * Auth: dev mode allows localhost; otherwise requires X-Admin-Secret header
 * matching ADMIN_SECRET env var.
 *
 * Pre-condition: framework/schema_v2.sql must already be applied.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFramework } from "@/lib/framework/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SeedResult {
  ok: boolean;
  domains_upserted?: number;
  sub_items_upserted?: number;
  metric_definitions_upserted?: number;
  errors?: string[];
  message?: string;
}

const METRIC_DEFINITIONS = [
  {
    source: "ga4",
    metric_key: "d1_activation_rate",
    mapped_sub_item_code: "A4.ACT.D1",
    transform_fn: ">=65% → v=5; 50-64% → v=4; 35-49% → v=3; 20-34% → v=2; <20% → v=1",
    threshold_rule: { red: "< 0.20", yellow: "0.20-0.49", green: ">= 0.50", unit: "ratio" },
    cadence: "daily",
  },
  {
    source: "mixpanel",
    metric_key: "m3_retention_rate",
    mapped_sub_item_code: "A2.RET.M3",
    transform_fn: ">=60% → v=5; 45-59% → v=4; 30-44% → v=3; 15-29% → v=2; <15% → v=1",
    threshold_rule: { red: "< 0.15", yellow: "0.15-0.44", green: ">= 0.45", unit: "ratio" },
    cadence: "weekly",
  },
  {
    source: "channeltalk",
    metric_key: "nps",
    mapped_sub_item_code: "A13.NPS.SCORE",
    transform_fn: ">=60 → v=5; 40-59 → v=4; 20-39 → v=3; 0-19 → v=2; <0 → v=1",
    threshold_rule: { red: "< 0", yellow: "0-39", green: ">= 40", unit: "nps" },
    cadence: "monthly",
  },
];

async function authorize(req: Request): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return false;
  return req.headers.get("x-admin-secret") === expected;
}

export async function POST(req: Request): Promise<NextResponse<SeedResult>> {
  if (!(await authorize(req))) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  const errors: string[] = [];
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

  let framework;
  try {
    framework = loadFramework();
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: `framework/question_bank.yaml 로드 실패: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 500 },
    );
  }

  // ---- 1. Upsert domain_definitions ----
  const domainRows = framework.domains.map((d) => ({
    code: d.code,
    name_ko: d.name_ko,
    name_en: d.name_en,
    tier: d.tier,
    weight: d.weight,
    threshold_red: d.thresholds.red,
    threshold_yellow: d.thresholds.yellow,
    threshold_green: d.thresholds.green,
    framework: d.framework,
    notes: d.notes ?? null,
    agent_prompt_id: d.code,
  }));

  const { error: domainErr, count: domainCount } = await sb
    .from("domain_definitions")
    .upsert(domainRows, { onConflict: "code", count: "exact" });

  if (domainErr) {
    errors.push(`domain_definitions: ${domainErr.code ?? "?"}: ${domainErr.message}`);
  }

  // ---- 2. Upsert sub_items ----
  const subItemRows = framework.domains.flatMap((d) =>
    d.groups.flatMap((g) =>
      g.sub_items.map((s) => ({
        code: s.code,
        domain_code: s.domain,
        group_code: s.group,
        tier: s.tier,
        weight_within_group: s.weight_within_group,
        belief: s.belief as unknown as Record<string, unknown>,
        evidence: s.evidence as unknown as Record<string, unknown>,
        citation: s.citation,
        failure_trigger: s.failure_trigger,
        cadence: s.cadence,
        data_quality_required: s.data_quality_required ?? 1,
        reverse_scoring: s.reverse_scoring ?? false,
        active: true,
      })),
    ),
  );

  const { error: subErr, count: subCount } = await sb
    .from("sub_items")
    .upsert(subItemRows, { onConflict: "code", count: "exact" });

  if (subErr) {
    errors.push(`sub_items: ${subErr.code ?? "?"}: ${subErr.message}`);
  }

  // ---- 3. Upsert metric_definitions ----
  const { error: metricErr, count: metricCount } = await sb
    .from("metric_definitions")
    .upsert(
      METRIC_DEFINITIONS.map((m) => ({ ...m, active: true })),
      { onConflict: "source,metric_key", count: "exact" },
    );

  if (metricErr) {
    errors.push(`metric_definitions: ${metricErr.code ?? "?"}: ${metricErr.message}`);
  }

  const ok = errors.length === 0;
  return NextResponse.json(
    {
      ok,
      domains_upserted: ok ? (domainCount ?? domainRows.length) : undefined,
      sub_items_upserted: ok ? (subCount ?? subItemRows.length) : undefined,
      metric_definitions_upserted: ok
        ? (metricCount ?? METRIC_DEFINITIONS.length)
        : undefined,
      errors: errors.length ? errors : undefined,
      message: ok
        ? `${domainCount ?? domainRows.length}개 도메인, ${subCount ?? subItemRows.length}개 항목, ${metricCount ?? METRIC_DEFINITIONS.length}개 KPI 매핑 시드 완료`
        : "일부 작업 실패 — errors 확인",
    },
    { status: ok ? 200 : 500 },
  );
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: true,
      message:
        "POST /api/admin/seed 로 호출하세요. dev 모드에서는 인증 불필요. 사전조건: framework/schema_v2.sql이 Supabase에 적용돼 있어야 합니다.",
    },
    { status: 200 },
  );
}

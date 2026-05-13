import { NextResponse } from "next/server";
import { deriveWorklistChanges } from "@/lib/agents/worklist-deriver";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";
import { syncMetricsToSubItems } from "@/lib/kpi/sync";

interface Body {
  text?: string;
  source?: string;
  period?: string;
  workspace?: string;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ALLOWED_PERIODS = new Set(["weekly", "monthly", "quarterly"]);
const ALLOWED_SOURCES = new Set([
  "ga4",
  "admin",
  "mixpanel",
  "channeltalk",
  "nps",
  "revenue",
  "other",
]);

/**
 * POST /api/worklist/derive
 *
 * 외부 데이터 분석 텍스트를 받아 워크리스트 변형 후보(overrides + derived)를
 * 반환한다. 결과를 LocalStorage에 저장하는 것은 클라이언트의 책임.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (text.length === 0) {
    return NextResponse.json({ error: "missing_text" }, { status: 400 });
  }
  if (text.length > 60_000) {
    return NextResponse.json(
      { error: "text_too_long", limit: 60_000 },
      { status: 413 },
    );
  }

  const source = (body.source ?? "other").toLowerCase();
  if (!ALLOWED_SOURCES.has(source)) {
    return NextResponse.json(
      { error: "invalid_source", allowed: Array.from(ALLOWED_SOURCES) },
      { status: 400 },
    );
  }

  const period = (body.period ?? "weekly").toLowerCase();
  if (!ALLOWED_PERIODS.has(period)) {
    return NextResponse.json(
      { error: "invalid_period", allowed: Array.from(ALLOWED_PERIODS) },
      { status: 400 },
    );
  }

  const workspace = body.workspace ?? "";
  if (!WS_PATTERN.test(workspace)) {
    return NextResponse.json({ error: "invalid_workspace" }, { status: 400 });
  }

  try {
    const result = await deriveWorklistChanges({
      text,
      source,
      period: period as "weekly" | "monthly" | "quarterly",
      workspace,
    });

    // C6 — 추출된 메트릭이 있으면 sub_item_responses 에 자동 upsert
    // (실패해도 워크리스트 결과는 정상 반환 — best-effort)
    let kpiSync: { matched: number; upserted: number; skipped: number } | null =
      null;
    if (result.metrics && result.metrics.length > 0) {
      try {
        const sb = supabaseAdmin();
        const org = await resolveOrgWithBackfill(sb, workspace);
        if (org) {
          kpiSync = await syncMetricsToSubItems(sb, org.id, result.metrics);
        }
      } catch (e) {
        console.warn(
          "[worklist/derive] KPI sync failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    return NextResponse.json({ ...result, kpi_sync: kpiSync });
  } catch (e) {
    return NextResponse.json(
      {
        error: "deriver_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}

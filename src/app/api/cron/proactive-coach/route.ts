/**
 * GET|POST /api/cron/proactive-coach
 *
 * 24시간 내 발생한 high-severity signal_events 중 아직 코치 진단이 없는 것들을
 * 골라 자동으로 agent_session 을 생성하고 finding 을 미리 준비한다.
 *
 * Anthropic prompt cache 를 십분 활용 — 같은 워크스페이스의 시스템 프롬프트는
 * 재사용되므로 여러 시그널 처리해도 비용 효율적.
 *
 * Production: 매 15분 cron (vercel.json).
 * Manual trigger: POST /api/cron/proactive-coach
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  triggerProactiveCoach,
  type ProactiveResult,
} from "@/lib/agents/proactive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Process signals with severity >= 3 (amber+) within last 24h
const MIN_SEVERITY = 3;
const LOOKBACK_HOURS = 24;
const MAX_PER_RUN = 10;

interface SignalRow {
  id: string;
  org_id: string;
  kind: string;
  domain_code: string | null;
  narrative: string;
  severity: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface OrgRow {
  id: string;
  name: string;
  stage: string | null;
}

async function authorize(req: Request): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

async function run(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();
  const cutoff = new Date(
    Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: signals, error: sigErr } = await sb
    .from("signal_events")
    .select(
      "id, org_id, kind, domain_code, narrative, severity, metadata, created_at",
    )
    .gte("severity", MIN_SEVERITY)
    .gte("created_at", cutoff)
    .not("domain_code", "is", null)
    .order("severity", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (sigErr) {
    return NextResponse.json(
      { ok: false, message: `signal_events 조회 실패: ${sigErr.message}` },
      { status: 500 },
    );
  }

  const candidates = (signals ?? []) as SignalRow[];
  const unprocessed = candidates.filter(
    (s) =>
      !(
        s.metadata &&
        typeof s.metadata === "object" &&
        "processed_session_id" in s.metadata &&
        s.metadata.processed_session_id
      ),
  );

  if (unprocessed.length === 0) {
    return NextResponse.json({
      ok: true,
      total_candidates: candidates.length,
      already_processed: candidates.length,
      processed_now: 0,
      results: [],
      checked_at: new Date().toISOString(),
    });
  }

  // Look up workspace_id and stage per org
  const orgIds = Array.from(new Set(unprocessed.map((s) => s.org_id)));
  const { data: orgs } = await sb
    .from("organizations")
    .select("id, name, stage")
    .in("id", orgIds);
  const orgMap = new Map(
    ((orgs ?? []) as OrgRow[]).map((o) => [o.id, o]),
  );

  const results: ProactiveResult[] = [];
  let processed = 0;
  for (const sig of unprocessed.slice(0, MAX_PER_RUN)) {
    const org = orgMap.get(sig.org_id);
    if (!org) {
      results.push({
        signal_id: sig.id,
        session_id: null,
        finding: null,
        applied: false,
        reason: "org not found",
      });
      continue;
    }
    if (!sig.domain_code) continue;
    const r = await triggerProactiveCoach({
      sb,
      signal_id: sig.id,
      workspace_id: org.name,
      domain_code: sig.domain_code,
      signal_kind: sig.kind,
      signal_narrative: sig.narrative,
      signal_severity: sig.severity,
      signal_metadata: sig.metadata ?? {},
      stage: (org.stage ?? "seed") as "pre_seed" | "seed" | "series_a" | "series_b" | "series_c_plus",
    });
    results.push(r);
    if (r.applied) processed++;
  }

  return NextResponse.json({
    ok: true,
    total_candidates: candidates.length,
    already_processed: candidates.length - unprocessed.length,
    processed_now: processed,
    results,
    checked_at: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}

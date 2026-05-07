/**
 * GET|POST /api/cron/quarterly-reminder
 *
 * 매주 1회 호출 (Vercel Cron 또는 수동). 분기 진단(90일) 이상 안 한
 * 워크스페이스를 찾아 signal_events 에 quarterly_due narrative 를 추가한다.
 *
 * 흐름:
 *  1. organizations 전체 + 각 워크스페이스의 가장 최근 diagnosis_responses 조회
 *  2. 마지막 진단이 90일 이전이면 후보. 단:
 *     - 7일 이내 같은 kind 의 signal 이 이미 있으면 skip (스팸 방지)
 *  3. signal narrative 에는 days_since + 가장 낮은 도메인 추천 포함
 *  4. severity: 90-120일 = 3, 120일+ = 4
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUARTERLY_DAYS = 90;
const IDEMPOTENCY_DAYS = 7;

interface OrgRow {
  id: string;
  name: string;
  stage: string | null;
}

interface DiagnosisResultDomainScore {
  code: string;
  score: number | null;
  tier_label?: string;
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
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - QUARTERLY_DAYS * 24 * 60 * 60 * 1000);
  const idempotencyDate = new Date(
    now.getTime() - IDEMPOTENCY_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data: orgsData, error: orgsErr } = await sb
    .from("organizations")
    .select("id, name, stage");

  if (orgsErr) {
    return NextResponse.json(
      { ok: false, message: `organizations 조회 실패: ${orgsErr.message}` },
      { status: 500 },
    );
  }

  const orgs = (orgsData ?? []) as OrgRow[];

  const newSignals: Array<Record<string, unknown>> = [];
  let skippedRecent = 0;
  let upToDate = 0;
  let neverDiagnosed = 0;

  for (const org of orgs) {
    const { data: latest } = await sb
      .from("diagnosis_responses")
      .select("completed_at, result, respondent_num")
      .eq("workspace_id", org.name)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      neverDiagnosed++;
      continue;
    }

    const lastDate = new Date(latest.completed_at);
    if (lastDate >= cutoffDate) {
      upToDate++;
      continue;
    }

    // Idempotency check
    const { data: recent } = await sb
      .from("signal_events")
      .select("id")
      .eq("org_id", org.id)
      .eq("kind", "quarterly_due")
      .gte("created_at", idempotencyDate.toISOString())
      .limit(1);

    if (recent && recent.length > 0) {
      skippedRecent++;
      continue;
    }

    const daysSince = Math.floor(
      (now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000),
    );

    // Recommend the worst critical domain from the latest result
    let recommendation = "";
    let lowestDomain: string | null = null;
    const result = latest.result as { domain_scores?: DiagnosisResultDomainScore[] } | null;
    if (result?.domain_scores && Array.isArray(result.domain_scores)) {
      const scored = result.domain_scores.filter(
        (d) => d.score !== null && d.score !== undefined,
      );
      if (scored.length > 0) {
        const sorted = [...scored].sort(
          (a, b) => (a.score ?? 100) - (b.score ?? 100),
        );
        const worst = sorted[0];
        lowestDomain = worst.code;
        recommendation = ` 마지막 결과 최저 도메인 ${worst.code}(${Math.round(worst.score ?? 0)}점) 우선 점검 권장.`;
      }
    }

    const severity = daysSince >= 120 ? 4 : 3;
    const narrative = `QUARTERLY DUE — 마지막 진단 ${daysSince}일 전 (${lastDate.toISOString().slice(0, 10)}). 분기 재진단 권장.${recommendation}`;

    newSignals.push({
      org_id: org.id,
      kind: "quarterly_due",
      domain_code: lowestDomain,
      narrative,
      severity,
      metadata: {
        last_diagnosis_at: latest.completed_at,
        days_since: daysSince,
        workspace_id: org.name,
        recommended_domain: lowestDomain,
        respondent_num: latest.respondent_num,
      },
    });
  }

  if (newSignals.length > 0) {
    const { error: insErr } = await sb
      .from("signal_events")
      .insert(newSignals);
    if (insErr) {
      return NextResponse.json(
        {
          ok: false,
          partial: true,
          message: `signal_events INSERT 실패: ${insErr.message}`,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    total_orgs: orgs.length,
    processed: newSignals.length,
    skipped_recent: skippedRecent,
    up_to_date: upToDate,
    never_diagnosed: neverDiagnosed,
    cutoff_date: cutoffDate.toISOString(),
    checked_at: now.toISOString(),
  });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}

/**
 * GET|POST /api/cron/follow-up
 *
 * 매일 1회 호출 (Vercel Cron 또는 수동). 만료된(overdue) coaching_actions 를
 * 찾아 signal_events 에 narrative 를 추가한다. 중복 방지를 위해 같은
 * action_id 에 대해 24시간 이내 signal 이 있으면 skip.
 *
 * 흐름:
 *  1. status IN ('accepted', 'in_progress') AND deadline < now() 인 액션 조회
 *  2. 각 액션마다:
 *     - 최근 24h 안에 같은 action_id 로 signal 이 있으면 skip
 *     - 없으면 signal_events INSERT (kind='action_overdue', severity 4)
 *     - 액션 상태 'in_progress' 로 자동 전이 (accepted → in_progress)
 *  3. 응답: 처리한 액션 수
 *
 * production cron 에서는 Authorization 헤더로 검증한다 (CRON_SECRET).
 * dev 모드에서는 검증 skip.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OverdueAction {
  id: string;
  org_id: string;
  session_id: string;
  title: string;
  owner_role: string | null;
  deadline: string;
  status: string;
}

interface RecentSignal {
  metadata: { action_id?: string } | null;
  created_at: string;
}

async function authorize(req: Request): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
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
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // 1) 만료 액션 조회
  const { data: overdue, error: overdueErr } = await sb
    .from("coaching_actions")
    .select("id, org_id, session_id, title, owner_role, deadline, status")
    .in("status", ["accepted", "in_progress"])
    .lt("deadline", nowIso)
    .limit(500);

  if (overdueErr) {
    return NextResponse.json(
      { ok: false, message: `coaching_actions 조회 실패: ${overdueErr.message}` },
      { status: 500 },
    );
  }
  const list = (overdue ?? []) as OverdueAction[];

  if (list.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      skipped_recent: 0,
      transitioned: 0,
      message: "오버듀 액션 없음",
      checked_at: nowIso,
    });
  }

  // 2) 최근 24h 내 action_overdue signal 이 있는지 일괄 조회
  const orgIds = Array.from(new Set(list.map((a) => a.org_id)));
  const { data: recentSignals } = await sb
    .from("signal_events")
    .select("metadata, created_at")
    .in("org_id", orgIds)
    .eq("kind", "action_overdue")
    .gte("created_at", cutoffIso);

  const recentActionIds = new Set<string>();
  for (const s of (recentSignals ?? []) as RecentSignal[]) {
    const id = s.metadata?.action_id;
    if (id) recentActionIds.add(id);
  }

  // 3) signal 추가 + 상태 전이
  const newSignals: Array<Record<string, unknown>> = [];
  let transitioned = 0;
  let skippedRecent = 0;

  for (const a of list) {
    if (recentActionIds.has(a.id)) {
      skippedRecent++;
      continue;
    }
    const daysOver = Math.max(
      0,
      Math.ceil((now.getTime() - new Date(a.deadline).getTime()) / (24 * 60 * 60 * 1000)),
    );
    const owner = a.owner_role ?? "?";
    const narrative = `OVERDUE — "${a.title.slice(0, 80)}${a.title.length > 80 ? "…" : ""}" (owner ${owner}, ${daysOver}d 지남, 현재 ${a.status})`;

    newSignals.push({
      org_id: a.org_id,
      kind: "action_overdue",
      domain_code: null,
      narrative,
      severity: daysOver >= 7 ? 5 : 4,
      metadata: {
        action_id: a.id,
        session_id: a.session_id,
        days_over: daysOver,
        prev_status: a.status,
      },
    });

    // accepted → in_progress 자동 전이 (한 번만)
    if (a.status === "accepted") {
      transitioned++;
    }
  }

  if (newSignals.length > 0) {
    const { error: insErr } = await sb.from("signal_events").insert(newSignals);
    if (insErr) {
      return NextResponse.json(
        {
          ok: false,
          message: `signal_events INSERT 실패: ${insErr.message}`,
          partial: true,
        },
        { status: 500 },
      );
    }
  }

  // 자동 전이: accepted 만 in_progress 로
  const transitionTargets = list
    .filter((a) => a.status === "accepted" && !recentActionIds.has(a.id))
    .map((a) => a.id);

  if (transitionTargets.length > 0) {
    await sb
      .from("coaching_actions")
      .update({ status: "in_progress", updated_at: nowIso })
      .in("id", transitionTargets);
  }

  return NextResponse.json({
    ok: true,
    processed: newSignals.length,
    skipped_recent: skippedRecent,
    transitioned,
    overdue_total: list.length,
    checked_at: nowIso,
  });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}

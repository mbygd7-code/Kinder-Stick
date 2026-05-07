/**
 * GET|POST /api/cron/sessions-cleanup
 *
 * idle agent_sessions 을 자동 정리한다. 정리 정책:
 *
 *  1. proactive 세션 + 14일 이상 활동 없음 + accepted action 0건 → 'abandoned'
 *     (사용자가 자동 finding을 무시한 케이스)
 *  2. 30일 이상 활동 없음 + verified/completed action 1건 이상 → 'resolved'
 *     (작업이 끝난 세션)
 *  3. 30일 이상 활동 없음 + active action만 있음 (accepted/in_progress) → 유지
 *     (팀이 여전히 작업 중)
 *  4. 30일 이상 활동 없음 + action 0건 → 'abandoned'
 *
 * 정리 시 signal_events 에 audit narrative 를 남긴다.
 *
 * 매일 02:00 UTC (11:00 KST) 자동 실행 (vercel.json).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROACTIVE_IDLE_DAYS = 14;
const STANDARD_IDLE_DAYS = 30;
const TERMINAL_STATES = new Set(["resolved", "abandoned"]);

interface SessionRow {
  id: string;
  org_id: string;
  domain_code: string;
  state: string;
  trigger_kind: string | null;
  opened_at: string;
  summary: string | null;
}

interface MessageActivity {
  session_id: string;
  last_activity: string;
}

interface ActionStatusCount {
  session_id: string;
  status: string;
  count: number;
}

interface CleanupDecision {
  session_id: string;
  prev_state: string;
  new_state: string;
  reason: string;
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
  const proactiveCutoff = new Date(
    now.getTime() - PROACTIVE_IDLE_DAYS * 24 * 60 * 60 * 1000,
  );
  const standardCutoff = new Date(
    now.getTime() - STANDARD_IDLE_DAYS * 24 * 60 * 60 * 1000,
  );

  // 1) Pull all non-terminal sessions
  const { data: sessions, error: sErr } = await sb
    .from("agent_sessions")
    .select("id, org_id, domain_code, state, trigger_kind, opened_at, summary")
    .not("state", "in", '("resolved","abandoned")')
    .limit(500);

  if (sErr) {
    return NextResponse.json(
      { ok: false, message: `agent_sessions 조회 실패: ${sErr.message}` },
      { status: 500 },
    );
  }
  const allSessions = (sessions ?? []) as SessionRow[];
  if (allSessions.length === 0) {
    return NextResponse.json({
      ok: true,
      total: 0,
      changed: 0,
      decisions: [],
      checked_at: now.toISOString(),
    });
  }

  // 2) Latest activity per session (max created_at across messages)
  const sessionIds = allSessions.map((s) => s.id);
  const { data: msgRows } = await sb
    .from("agent_messages")
    .select("session_id, created_at")
    .in("session_id", sessionIds);

  const latestActivity = new Map<string, string>();
  for (const m of (msgRows ?? []) as Array<{
    session_id: string;
    created_at: string;
  }>) {
    const cur = latestActivity.get(m.session_id);
    if (!cur || cur < m.created_at) {
      latestActivity.set(m.session_id, m.created_at);
    }
  }

  // 3) Action counts per session × status
  const { data: actRows } = await sb
    .from("coaching_actions")
    .select("session_id, status")
    .in("session_id", sessionIds);

  const actionsBySession = new Map<string, Map<string, number>>();
  for (const a of (actRows ?? []) as Array<{
    session_id: string;
    status: string;
  }>) {
    if (!actionsBySession.has(a.session_id)) {
      actionsBySession.set(a.session_id, new Map());
    }
    const m = actionsBySession.get(a.session_id)!;
    m.set(a.status, (m.get(a.status) ?? 0) + 1);
  }

  // 4) Decision per session
  const decisions: CleanupDecision[] = [];
  for (const s of allSessions) {
    const lastAct = latestActivity.get(s.id) ?? s.opened_at;
    const lastActDate = new Date(lastAct);
    const acts = actionsBySession.get(s.id) ?? new Map<string, number>();
    const accepted = acts.get("accepted") ?? 0;
    const inProgress = acts.get("in_progress") ?? 0;
    const completed = acts.get("completed") ?? 0;
    const verified = acts.get("verified") ?? 0;
    const totalActions = Array.from(acts.values()).reduce(
      (s, x) => s + x,
      0,
    );

    let newState: string | null = null;
    let reason = "";

    // Rule 1: proactive abandoned
    if (
      s.trigger_kind === "proactive" &&
      lastActDate < proactiveCutoff &&
      totalActions === 0
    ) {
      newState = "abandoned";
      reason = `proactive idle ${PROACTIVE_IDLE_DAYS}d+ 이고 액션 채택 없음`;
    } else if (lastActDate < standardCutoff) {
      // Rule 2: resolved if verified/completed
      if (verified > 0 || completed > 0) {
        newState = "resolved";
        reason = `idle ${STANDARD_IDLE_DAYS}d+, 완료된 액션 있음 (verified ${verified} / completed ${completed})`;
      }
      // Rule 3: keep if active
      else if (accepted > 0 || inProgress > 0) {
        newState = null;
        reason = `idle ${STANDARD_IDLE_DAYS}d+ but 작업 중 액션 보유 — 유지`;
      }
      // Rule 4: abandoned if no actions
      else if (totalActions === 0) {
        newState = "abandoned";
        reason = `idle ${STANDARD_IDLE_DAYS}d+, 액션 없음`;
      }
    }

    if (newState && !TERMINAL_STATES.has(s.state)) {
      decisions.push({
        session_id: s.id,
        prev_state: s.state,
        new_state: newState,
        reason,
      });
    }
  }

  // 5) Apply transitions + emit audit signals
  let changed = 0;
  for (const d of decisions) {
    const session = allSessions.find((s) => s.id === d.session_id)!;
    const { error: updErr } = await sb
      .from("agent_sessions")
      .update({
        state: d.new_state,
        resolved_at: now.toISOString(),
      })
      .eq("id", d.session_id);
    if (updErr) {
      d.reason += ` (update failed: ${updErr.message})`;
      continue;
    }
    changed++;

    await sb.from("signal_events").insert({
      org_id: session.org_id,
      kind: "session_cleanup",
      domain_code: session.domain_code,
      narrative: `SESSION ${d.new_state.toUpperCase()} — ${session.domain_code} #${d.session_id.slice(0, 8)} ${d.reason}${session.summary ? ` (summary: "${session.summary.slice(0, 60)}")` : ""}`,
      severity: 1,
      metadata: {
        session_id: d.session_id,
        prev_state: d.prev_state,
        new_state: d.new_state,
        applied_by: "sessions-cleanup-cron",
        reason: d.reason,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    total: allSessions.length,
    changed,
    decisions,
    checked_at: now.toISOString(),
  });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}

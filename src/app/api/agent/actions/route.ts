/**
 * POST   /api/agent/actions       — 새 SMART action 채택
 * PATCH  /api/agent/actions       — owner/deadline/status 변경 (body.id)
 *
 * coaching_actions 테이블에 row를 만들고 진행 상태를 추적한다.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchAction } from "@/lib/integrations/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUS = new Set([
  "proposed",
  "accepted",
  "in_progress",
  "completed",
  "verified",
  "failed",
  "abandoned",
]);

interface CreateBody {
  session_id: string;
  title: string;
  smart_payload: Record<string, unknown>;
  owner_role?: string;
  deadline_days?: number;
  verification_metric?: string | Record<string, unknown>;
  /**
   * C5 — 이 액션이 어느 sub_item 의 evidence 를 변경할 의도인지.
   * 예: "A2.SE.40" — Sean Ellis 측정값 evidence v 를 1→4 로 끌어올리는 액션.
   * smart_payload 에도 함께 저장되어 추후 추적·workflows 와 연결.
   */
  sub_item_code?: string;
}

interface PatchBody {
  id: string;
  status?: string;
  owner_role?: string;
  deadline?: string; // ISO
  verification_metric?: Record<string, unknown>;
}

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { session_id, title, smart_payload } = body;
  if (!session_id || !title || !smart_payload) {
    return NextResponse.json(
      { ok: false, message: "session_id, title, smart_payload 필요" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Verify session exists + get org_id and domain
  const { data: session, error: sErr } = await sb
    .from("agent_sessions")
    .select("id, org_id, domain_code, summary")
    .eq("id", session_id)
    .single();

  if (sErr || !session) {
    return NextResponse.json(
      { ok: false, message: `session not found: ${sErr?.message ?? "?"}` },
      { status: 404 },
    );
  }

  const deadlineDays =
    typeof body.deadline_days === "number"
      ? Math.max(1, Math.min(365, Math.round(body.deadline_days)))
      : 14;
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + deadlineDays);

  const verificationMetric =
    typeof body.verification_metric === "string"
      ? { description: body.verification_metric }
      : body.verification_metric ?? null;

  // C5 — sub_item_code 가 명시되면 smart_payload 에 합쳐 저장 (스키마 추가 없이 jsonb 활용)
  const enrichedPayload: Record<string, unknown> = {
    ...smart_payload,
    ...(body.sub_item_code
      ? {
          sub_item_code: body.sub_item_code,
          target_sub_item: body.sub_item_code, // 호환성: 다른 이름으로도 검색 가능
        }
      : {}),
  };

  const { data: inserted, error: insErr } = await sb
    .from("coaching_actions")
    .insert({
      session_id,
      org_id: session.org_id,
      title,
      smart_payload: enrichedPayload,
      owner_role: body.owner_role ?? null,
      deadline: deadline.toISOString(),
      status: "accepted",
      verification_metric: verificationMetric,
    })
    .select(
      "id, title, owner_role, deadline, status, verification_metric, created_at, smart_payload",
    )
    .single();

  if (insErr || !inserted) {
    return NextResponse.json(
      {
        ok: false,
        message: `coaching_actions INSERT 실패: ${insErr?.code ?? "?"}: ${insErr?.message}`,
      },
      { status: 500 },
    );
  }

  // Resolve workspace_id from org for dispatch payload
  const { data: org } = await sb
    .from("organizations")
    .select("name")
    .eq("id", session.org_id)
    .maybeSingle();
  const workspace_id = org?.name ?? "unknown";

  // Fire dispatch — Notion + Slack. Fire-and-await so the response can include
  // dispatch metadata; both calls run in parallel and have generous timeouts.
  let dispatchSummary;
  try {
    dispatchSummary = await dispatchAction({
      action_id: inserted.id,
      workspace_id,
      title: inserted.title,
      owner_role: inserted.owner_role,
      deadline: inserted.deadline,
      status: inserted.status,
      verification_metric:
        verificationMetric &&
        typeof (verificationMetric as { description?: string }).description === "string"
          ? (verificationMetric as { description: string }).description
          : null,
      domain_code: session.domain_code,
      finding_excerpt: session.summary?.slice(0, 300) ?? null,
    });
  } catch (e) {
    dispatchSummary = {
      notion: {
        ok: false,
        mock: false,
        configured: false,
        dispatched_at: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      },
      slack: {
        ok: false,
        mock: false,
        configured: false,
        dispatched_at: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      },
      any_real_dispatch: false,
    };
  }

  // Persist dispatch metadata into smart_payload (best-effort)
  await sb
    .from("coaching_actions")
    .update({
      smart_payload: {
        ...((inserted.smart_payload as Record<string, unknown>) ?? {}),
        integrations: dispatchSummary,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", inserted.id);

  return NextResponse.json({
    ok: true,
    action: {
      ...inserted,
      smart_payload: {
        ...((inserted.smart_payload as Record<string, unknown>) ?? {}),
        integrations: dispatchSummary,
      },
    },
    integrations: dispatchSummary,
  });
}

export async function PATCH(req: Request) {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.id) {
    return NextResponse.json(
      { ok: false, message: "id 필요" },
      { status: 400 },
    );
  }
  if (body.status && !VALID_STATUS.has(body.status)) {
    return NextResponse.json(
      { ok: false, message: `invalid status: ${body.status}` },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) update.status = body.status;
  if (body.owner_role !== undefined) update.owner_role = body.owner_role;
  if (body.deadline) update.deadline = body.deadline;
  if (body.verification_metric)
    update.verification_metric = body.verification_metric;
  if (body.status === "verified") {
    update.verified_at = new Date().toISOString();
  }

  const { data, error } = await sb
    .from("coaching_actions")
    .update(update)
    .eq("id", body.id)
    .select(
      "id, title, owner_role, deadline, status, verified_at, verification_metric",
    )
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "update failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, action: data });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST { session_id, title, smart_payload, owner_role?, deadline_days?, verification_metric? } / PATCH { id, status?, owner_role?, deadline?, verification_metric? }",
  });
}

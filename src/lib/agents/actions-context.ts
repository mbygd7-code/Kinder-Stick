/**
 * Workspace 의 코칭 액션 상태를 조회해 RetrievedAction[] 으로 변환.
 * sessions/start, messages 양쪽에서 코치 시스템 프롬프트에 주입한다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetrievedAction } from "./build-prompt";

interface ActionRow {
  id: string;
  session_id: string;
  title: string;
  owner_role: string | null;
  deadline: string | null;
  status: string;
  verification_metric: { description?: string } | null;
}

interface SessionRow {
  id: string;
  domain_code: string | null;
}

export async function fetchWorkspaceActions(
  sb: SupabaseClient,
  orgId: string,
  limit = 30,
): Promise<RetrievedAction[]> {
  const { data, error } = await sb
    .from("coaching_actions")
    .select(
      "id, session_id, title, owner_role, deadline, status, verification_metric",
    )
    .eq("org_id", orgId)
    .order("deadline", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error || !data || data.length === 0) return [];

  const rows = data as ActionRow[];

  // Lookup domain codes per session_id
  const sessionIds = Array.from(new Set(rows.map((r) => r.session_id)));
  let domainBySession = new Map<string, string | null>();
  if (sessionIds.length > 0) {
    const { data: sessions } = await sb
      .from("agent_sessions")
      .select("id, domain_code")
      .in("id", sessionIds);
    domainBySession = new Map(
      ((sessions ?? []) as SessionRow[]).map((s) => [s.id, s.domain_code]),
    );
  }

  const now = Date.now();
  return rows.map((r) => {
    const deadlineMs = r.deadline ? new Date(r.deadline).getTime() : null;
    const daysLeft =
      deadlineMs === null
        ? null
        : Math.ceil((deadlineMs - now) / (24 * 60 * 60 * 1000));
    const isOverdue =
      daysLeft !== null &&
      daysLeft < 0 &&
      (r.status === "accepted" || r.status === "in_progress");
    return {
      id: r.id,
      title: r.title,
      owner_role: r.owner_role,
      deadline: r.deadline,
      status: r.status,
      domain_code: domainBySession.get(r.session_id) ?? null,
      days_left: daysLeft,
      is_overdue: isOverdue,
      verification_metric: r.verification_metric?.description ?? null,
    };
  });
}

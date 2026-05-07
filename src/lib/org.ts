/**
 * Workspace → Organization upsert.
 *
 * 익명 진단 워크스페이스 ID를 organizations.name에 매핑하고,
 * agent_sessions.org_id로 사용할 안정 UUID를 반환한다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Stage } from "./scoring";

export interface WorkspaceOrg {
  id: string;
  name: string;
  stage: Stage;
}

/**
 * workspace_id로 organization을 조회하고, 없으면 생성한다.
 * service-role 클라이언트로 호출해야 한다 (RLS 우회).
 */
export async function ensureWorkspaceOrg(
  sb: SupabaseClient,
  workspaceId: string,
  stage: Stage = "seed",
): Promise<WorkspaceOrg> {
  // Try existing
  const { data: existing, error: selErr } = await sb
    .from("organizations")
    .select("id, name, stage")
    .eq("name", workspaceId)
    .limit(1)
    .maybeSingle();

  if (selErr && selErr.code !== "PGRST116") {
    throw new Error(`organization 조회 실패: ${selErr.message}`);
  }
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      stage: (existing.stage ?? stage) as Stage,
    };
  }

  // Create
  const { data: inserted, error: insErr } = await sb
    .from("organizations")
    .insert({
      name: workspaceId,
      stage,
      industry: "edtech_korea",
      plan: "anonymous",
      active_domains: [
        "A1",
        "A2",
        "A3",
        "A4",
        "A5",
        "A6",
        "A7",
        "A8",
        "A9",
        "A10",
        "A11",
        "A12",
        "A13",
        "A14",
      ],
      settings: { source: "anonymous_workspace" } as Record<string, unknown>,
    })
    .select("id, name, stage")
    .single();

  if (insErr) {
    throw new Error(
      `organization 생성 실패: ${insErr.code ?? "?"}: ${insErr.message}`,
    );
  }
  return {
    id: inserted.id,
    name: inserted.name,
    stage: (inserted.stage ?? stage) as Stage,
  };
}

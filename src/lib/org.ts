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

/**
 * 워크스페이스 페이지의 표준 org 조회 + backfill 헬퍼.
 *
 * 1. organizations 테이블에서 name=workspace로 조회
 * 2. 없으면 diagnosis_responses에 응답이 있는지 확인
 * 3. 응답이 있으면 가장 최근 stage로 organization row 자동 생성 (backfill)
 * 4. 응답도 없으면 null 반환 (진짜 빈 워크스페이스)
 *
 * 이 함수는 모든 /diag/[workspace]/* 페이지에서 사용해야 한다 — 그렇지
 * 않으면 워크스페이스마다 일부 페이지는 동작하고 일부는 "no workspace"로
 * 빠지는 일관성 없는 UX가 발생한다.
 */
export async function resolveOrgWithBackfill(
  sb: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceOrg | null> {
  const { data: existing } = await sb
    .from("organizations")
    .select("id, name, stage")
    .eq("name", workspaceId)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      stage: (existing.stage ?? "seed") as Stage,
    };
  }

  // No org row — check if there's diagnosis data to back-fill from
  const { count } = await sb
    .from("diagnosis_responses")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if ((count ?? 0) === 0) {
    return null; // truly empty workspace
  }

  // Pull latest stage and backfill
  const { data: row } = await sb
    .from("diagnosis_responses")
    .select("stage")
    .eq("workspace_id", workspaceId)
    .order("respondent_num", { ascending: false })
    .limit(1)
    .maybeSingle();
  const stage = ((row?.stage as Stage) ?? "seed") as Stage;
  try {
    return await ensureWorkspaceOrg(sb, workspaceId, stage);
  } catch {
    return null;
  }
}

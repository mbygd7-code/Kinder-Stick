/**
 * Server-side helper — Supabase 의 kso_ops_context 에서 OpsContext 를 읽어
 * DiagnosisProfile 로 변환. SSR 페이지가 aggregateRespondents 에 넘길 때 사용.
 *
 * OpsContext 가 없으면 null 반환 (기본 frame 사용 — 적응 없음).
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { computeDiagnosisProfile } from "./compute";
import type { DiagnosisProfile } from "./types";
import type { OpsContext } from "@/app/diag/[workspace]/_ops-context-section";

export async function fetchDiagnosisProfile(
  workspace: string,
): Promise<DiagnosisProfile | null> {
  try {
    const sb = supabaseAdmin();
    const { data: row } = await sb
      .from("kso_ops_context")
      .select("data")
      .eq("workspace_id", workspace)
      .maybeSingle();
    const ctx = (row?.data as OpsContext | null) ?? null;
    if (!ctx || Object.keys(ctx).length === 0) return null;
    return computeDiagnosisProfile(ctx);
  } catch {
    // 테이블 미존재·권한·연결 실패 — 안전 fallback (적응 없음)
    return null;
  }
}

/**
 * Batch fetch — 여러 워크스페이스의 profile 을 한 번의 쿼리로 fetch.
 * /diag/page.tsx (카드 그리드) 처럼 N+1 우려 시 사용.
 *
 * 비어있는/실패한 워크스페이스는 결과 객체에 null 로 포함.
 */
export async function fetchDiagnosisProfilesBatch(
  workspaces: string[],
): Promise<Record<string, DiagnosisProfile | null>> {
  const out: Record<string, DiagnosisProfile | null> = {};
  if (workspaces.length === 0) return out;
  // 빈 fallback (테이블 접근 실패 대비)
  for (const ws of workspaces) out[ws] = null;
  try {
    const sb = supabaseAdmin();
    const { data: rows } = await sb
      .from("kso_ops_context")
      .select("workspace_id, data")
      .in("workspace_id", workspaces);
    if (rows) {
      for (const row of rows as Array<{
        workspace_id: string;
        data: OpsContext | null;
      }>) {
        const ctx = row.data ?? null;
        if (!ctx || Object.keys(ctx).length === 0) continue;
        out[row.workspace_id] = computeDiagnosisProfile(ctx);
      }
    }
  } catch {
    // 안전 fallback — 모든 워크스페이스 null 유지
  }
  return out;
}

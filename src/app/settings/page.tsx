/**
 * /settings — 사용자 설정 페이지.
 *
 * 구조:
 *   - (A) 계정 정보 (email/표시이름/팀/생성일/최근 로그인)
 *   - (B) PIN 변경
 *   - (C) 관리자 영역 (admin only) — 사용자 목록·권한·잠금 해제·삭제
 *   - (D) 위험 영역 — 로그아웃·내 계정 삭제
 *
 * server component → 인증 확인 후 client shell 에 props 전달.
 */

import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { SettingsClient } from "./_settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await getCurrentProfile();
  if (!me) {
    redirect("/auth/login?next=/settings");
  }

  // server 에서 계정 정보 일부 추가 조회 (created_at/last_login_at)
  let createdAt: string | null = null;
  let lastLoginAt: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("kso_profiles")
      .select("created_at, last_login_at")
      .eq("id", me.id)
      .maybeSingle();
    createdAt = (data?.created_at as string | null) ?? null;
    lastLoginAt = (data?.last_login_at as string | null) ?? null;
  } catch {
    // best-effort
  }

  return (
    <SettingsClient
      me={{
        id: me.id,
        email: me.email,
        role: me.role,
        team: me.team,
        display_name: me.display_name,
        created_at: createdAt,
        last_login_at: lastLoginAt,
      }}
    />
  );
}

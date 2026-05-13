/**
 * Custom PIN session 헬퍼 (server-side).
 *
 * 사용:
 *   const me = await getCurrentProfile();   // server component / route handler
 *   if (!me) … 로그인 필요
 *   if (me.role === "admin") …
 */

import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifySession, SESSION_COOKIE, type Team } from "./pin";

export interface CurrentProfile {
  id: string;
  email: string;
  role: "admin" | "member";
  team: Team | null;
  display_name: string | null;
}

/**
 * 쿠키에서 세션 토큰을 읽어 검증 후 profile 반환.
 * - 쿠키 없음·만료·서명불일치 → null
 * - DB row 가 사라졌으면 (계정 삭제) → null
 */
export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const payload = verifySession(token);
  if (!payload) return null;

  // DB 조회로 최신 role/team 반영 (캐시된 토큰 신뢰 X)
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("kso_profiles")
    .select("id, email, role, team, display_name")
    .eq("id", payload.uid)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    email: data.email as string,
    role: (data.role as "admin" | "member") ?? "member",
    team: (data.team as Team | null) ?? null,
    display_name: (data.display_name as string | null) ?? null,
  };
}

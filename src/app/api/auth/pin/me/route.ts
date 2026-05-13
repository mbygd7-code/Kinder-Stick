/**
 * GET /api/auth/pin/me
 * 현재 세션의 profile 반환 (없으면 null).
 *
 * 클라이언트의 자동 로그인 흐름에서 사용.
 */

import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentProfile();
  return NextResponse.json({ profile: me });
}

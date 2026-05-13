/**
 * POST /api/auth/pin/logout
 * 세션 쿠키 제거.
 */

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/pin";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

/**
 * DELETE /api/workspace/[ws]/invite/[email]
 * Owner/admin revokes a pending invitation.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ ws: string; email: string }> },
) {
  const { ws, email: emailRaw } = await params;
  const email = decodeURIComponent(emailRaw).toLowerCase();
  if (!WS_PATTERN.test(ws)) {
    return NextResponse.json(
      { ok: false, message: "invalid workspace_id" },
      { status: 400 },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "로그인 필요" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();
  const { data: org } = await sb
    .from("organizations")
    .select("id, settings")
    .eq("name", ws)
    .maybeSingle();
  if (!org) {
    return NextResponse.json(
      { ok: false, message: "진단 카드 없음" },
      { status: 404 },
    );
  }
  const { data: caller } = await sb
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!caller || !["owner", "admin"].includes(caller.role as string)) {
    return NextResponse.json(
      { ok: false, message: "owner/admin 권한 필요" },
      { status: 403 },
    );
  }

  const settings = (org.settings as Record<string, unknown> | null) ?? {};
  const pending = Array.isArray(settings.pending_invites)
    ? ((settings.pending_invites as string[]).filter((e) => e.toLowerCase() !== email))
    : [];

  await sb
    .from("organizations")
    .update({
      settings: { ...settings, pending_invites: pending },
    })
    .eq("id", org.id);

  return NextResponse.json({ ok: true, remaining: pending.length });
}

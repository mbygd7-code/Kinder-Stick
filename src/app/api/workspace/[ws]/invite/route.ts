/**
 * POST /api/workspace/[ws]/invite
 * body: { email }
 *
 * Owner/admin adds an email to organizations.settings.pending_invites.
 * When that user logs in via /auth/callback, the matching invite is consumed
 * and they're auto-added to org_members as 'contributor'.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ws: string }> },
) {
  const { ws } = await params;
  if (!WS_PATTERN.test(ws)) {
    return NextResponse.json(
      { ok: false, message: "invalid workspace_id" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON" },
      { status: 400 },
    );
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { ok: false, message: "유효한 이메일 필요" },
      { status: 400 },
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
      { ok: false, message: "워크스페이스가 없습니다" },
      { status: 404 },
    );
  }

  // Authorization: only owner/admin can invite
  const { data: caller } = await sb
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!caller || !["owner", "admin"].includes(caller.role as string)) {
    return NextResponse.json(
      {
        ok: false,
        message: "owner 또는 admin 권한이 필요합니다",
      },
      { status: 403 },
    );
  }

  const settings = (org.settings as Record<string, unknown> | null) ?? {};
  const pendingInvites = Array.isArray(settings.pending_invites)
    ? ([...settings.pending_invites] as string[])
    : [];
  if (pendingInvites.includes(email)) {
    return NextResponse.json({ ok: true, already_invited: true });
  }
  pendingInvites.push(email);

  const { error: updErr } = await sb
    .from("organizations")
    .update({
      settings: { ...settings, pending_invites: pendingInvites },
    })
    .eq("id", org.id);

  if (updErr) {
    return NextResponse.json(
      { ok: false, message: updErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    email,
    pending_invites_count: pendingInvites.length,
    note: "초대된 사용자가 같은 이메일로 매직링크 로그인 시 자동으로 contributor 등록됩니다.",
  });
}

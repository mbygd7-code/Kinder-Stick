/**
 * PATCH  /api/workspace/[ws]/members/[userId]   body: { role }
 * DELETE /api/workspace/[ws]/members/[userId]
 *
 * Owner-only. Modify another member's role or remove them.
 * Owner cannot remove themselves if they are the last owner.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = new Set([
  "owner",
  "admin",
  "lead",
  "contributor",
  "viewer",
]);
const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

async function ensureAuth(req: Request, ws: string) {
  if (!WS_PATTERN.test(ws)) {
    return { error: NextResponse.json({ ok: false, message: "invalid workspace_id" }, { status: 400 }) };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ ok: false, message: "로그인 필요" }, { status: 401 }) };
  }
  const sb = supabaseAdmin();
  const { data: org } = await sb
    .from("organizations")
    .select("id")
    .eq("name", ws)
    .maybeSingle();
  if (!org) {
    return { error: NextResponse.json({ ok: false, message: "워크스페이스 없음" }, { status: 404 }) };
  }
  const { data: caller } = await sb
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!caller || caller.role !== "owner") {
    return { error: NextResponse.json({ ok: false, message: "owner 권한 필요" }, { status: 403 }) };
  }
  return { sb, org, user, caller };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ws: string; userId: string }> },
) {
  const { ws, userId } = await params;
  const auth = await ensureAuth(req, ws);
  if (auth.error) return auth.error;
  const { sb, org } = auth;

  let body: { role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON" },
      { status: 400 },
    );
  }
  if (!body.role || !VALID_ROLES.has(body.role)) {
    return NextResponse.json(
      { ok: false, message: `invalid role: ${body.role}` },
      { status: 400 },
    );
  }

  // Prevent demoting the last owner
  if (body.role !== "owner") {
    const { count } = await sb
      .from("org_members")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) {
      const { data: target } = await sb
        .from("org_members")
        .select("role")
        .eq("org_id", org.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (target?.role === "owner") {
        return NextResponse.json(
          {
            ok: false,
            message: "마지막 owner 는 demote 할 수 없습니다",
          },
          { status: 400 },
        );
      }
    }
  }

  const { error } = await sb
    .from("org_members")
    .update({ role: body.role })
    .eq("org_id", org.id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ ws: string; userId: string }> },
) {
  const { ws, userId } = await params;
  const auth = await ensureAuth(req, ws);
  if (auth.error) return auth.error;
  const { sb, org } = auth;

  // Prevent removing last owner
  const { data: target } = await sb
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) {
    return NextResponse.json(
      { ok: false, message: "membership not found" },
      { status: 404 },
    );
  }
  if (target.role === "owner") {
    const { count } = await sb
      .from("org_members")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        {
          ok: false,
          message: "마지막 owner 는 제거할 수 없습니다",
        },
        { status: 400 },
      );
    }
  }

  const { error } = await sb
    .from("org_members")
    .delete()
    .eq("org_id", org.id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

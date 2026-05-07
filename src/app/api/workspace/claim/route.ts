/**
 * POST /api/workspace/claim
 * body: { workspace_id }
 *
 * Authenticated user claims an organization as a member.
 * - If org_members already has (user_id, org_id) → no-op
 * - If org doesn't exist → creates anonymous org first
 * - Default role: 'owner' (first claimer becomes owner; others become contributor)
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { ensureWorkspaceOrg } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  let body: { workspace_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "invalid JSON" },
      { status: 400 },
    );
  }
  const { workspace_id } = body;
  if (!workspace_id || !WS_PATTERN.test(workspace_id)) {
    return NextResponse.json(
      { ok: false, message: "workspace_id 형식 오류" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const org = await ensureWorkspaceOrg(sb, workspace_id, "seed");

  // Check existing membership
  const { data: existing } = await sb
    .from("org_members")
    .select("id, role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      already_member: true,
      role: existing.role,
      org_id: org.id,
      workspace_id,
    });
  }

  // Determine role: first claim → owner, otherwise contributor
  const { count } = await sb
    .from("org_members")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id);
  const role = (count ?? 0) === 0 ? "owner" : "contributor";

  const { error: insErr } = await sb.from("org_members").insert({
    org_id: org.id,
    user_id: user.id,
    role,
  });

  if (insErr) {
    return NextResponse.json(
      {
        ok: false,
        message: `org_members INSERT 실패: ${insErr.code ?? "?"}: ${insErr.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    role,
    org_id: org.id,
    workspace_id,
  });
}

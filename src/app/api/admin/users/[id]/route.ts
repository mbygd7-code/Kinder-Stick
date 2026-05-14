/**
 * PATCH  /api/admin/users/[id]    body: { role?, team?, display_name?, unlock? }
 * DELETE /api/admin/users/[id]
 *
 * 관리자 전용 — 사용자 권한·팀·표시이름 변경 또는 삭제.
 * 마지막 관리자 보호:
 *   - role 을 admin → member 로 강등할 때 admin 카운트 1 이면 거부
 *   - DELETE 도 동일
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { isValidTeam } from "@/lib/auth/pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gateAdmin() {
  const me = await getCurrentProfile();
  if (!me)
    return {
      err: NextResponse.json(
        { ok: false, message: "로그인이 필요합니다" },
        { status: 401 },
      ),
    };
  if (me.role !== "admin")
    return {
      err: NextResponse.json(
        { ok: false, message: "관리자 권한이 필요합니다" },
        { status: 403 },
      ),
    };
  return { me };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await gateAdmin();
  if (gate.err) return gate.err;

  const { id } = await ctx.params;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
    return NextResponse.json(
      { ok: false, message: "잘못된 사용자 ID" },
      { status: 400 },
    );
  }

  let body: {
    role?: string;
    team?: string | null;
    display_name?: string | null;
    unlock?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "잘못된 JSON" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const updates: Record<string, unknown> = {};

  if ("role" in body && body.role) {
    if (body.role !== "admin" && body.role !== "member") {
      return NextResponse.json(
        { ok: false, message: "role 은 admin 또는 member" },
        { status: 400 },
      );
    }
    // 강등 시 마지막 admin 보호
    if (body.role === "member") {
      const { data: target } = await sb
        .from("kso_profiles")
        .select("role")
        .eq("id", id)
        .maybeSingle();
      if (target?.role === "admin") {
        const { count } = await sb
          .from("kso_profiles")
          .select("*", { count: "exact", head: true })
          .eq("role", "admin");
        if ((count ?? 0) <= 1) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "마지막 관리자입니다 — 다른 사람을 먼저 관리자로 승격하세요",
            },
            { status: 409 },
          );
        }
      }
    }
    updates.role = body.role;
  }

  if ("team" in body) {
    const t = body.team ?? null;
    if (t && !isValidTeam(t)) {
      return NextResponse.json(
        { ok: false, message: "team 값이 올바르지 않습니다" },
        { status: 400 },
      );
    }
    updates.team = t || null;
  }

  if ("display_name" in body) {
    const dn = body.display_name?.toString().trim() ?? null;
    if (dn && dn.length > 40) {
      return NextResponse.json(
        { ok: false, message: "표시이름은 40자 이내" },
        { status: 400 },
      );
    }
    updates.display_name = dn || null;
  }

  if (body.unlock) {
    updates.locked_until = null;
    updates.failed_attempts = 0;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const { error } = await sb
    .from("kso_profiles")
    .update(updates)
    .eq("id", id);
  if (error) {
    return NextResponse.json(
      { ok: false, message: `업데이트 실패: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, changed: Object.keys(updates).length });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await gateAdmin();
  if (gate.err) return gate.err;

  const { id } = await ctx.params;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
    return NextResponse.json(
      { ok: false, message: "잘못된 사용자 ID" },
      { status: 400 },
    );
  }

  // 본인 삭제 차단 (위험)
  if (gate.me && id === gate.me.id) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "본인 계정은 여기서 삭제할 수 없습니다 — 위험 영역 → 내 계정 삭제 이용",
      },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data: target } = await sb
    .from("kso_profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();

  // 마지막 admin 보호
  if (target?.role === "admin") {
    const { count } = await sb
      .from("kso_profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "마지막 관리자입니다 — 다른 사람을 먼저 관리자로 승격하세요",
        },
        { status: 409 },
      );
    }
  }

  const { error } = await sb.from("kso_profiles").delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { ok: false, message: `삭제 실패: ${error.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

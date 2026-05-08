/**
 * After a user authenticates (via magic link), claim any pending invites
 * matching their email. Adds them as 'contributor' to those orgs.
 *
 * Idempotent: safe to call multiple times. Best-effort — failures are
 * logged but don't block the user.
 */

import { NextResponse } from "next/server";
import { supabaseServerCtx } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const sb = await supabaseServerCtx();
  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser();

  if (userErr || !user?.email) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const email = user.email.toLowerCase();
  const admin = supabaseAdmin();
  let claimed = 0;

  try {
    const { data: orgs } = await admin
      .from("organizations")
      .select("id, settings");

    for (const org of (orgs ?? []) as Array<{
      id: string;
      settings: Record<string, unknown> | null;
    }>) {
      const settings = org.settings ?? {};
      const pending = Array.isArray(settings.pending_invites)
        ? (settings.pending_invites as string[]).map((e) => e.toLowerCase())
        : [];
      if (!pending.includes(email)) continue;

      await admin.from("org_members").upsert(
        {
          org_id: org.id,
          user_id: user.id,
          role: "contributor",
        },
        { onConflict: "org_id,user_id" },
      );
      await admin
        .from("organizations")
        .update({
          settings: {
            ...settings,
            pending_invites: pending.filter((e) => e !== email),
          },
        })
        .eq("id", org.id);
      claimed += 1;
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        claimed,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, claimed });
}

/**
 * Supabase magic-link callback handler.
 *   /auth/callback?code=... → exchanges for session cookie → redirect to /me
 *
 * After exchange, scans organizations.settings.pending_invites for matches
 * against the user's email. Each match auto-creates an org_members row
 * (role='contributor') and removes the email from pending list.
 */

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServerCtx } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/me";

  if (!code) {
    return NextResponse.redirect(new URL("/auth/login?error=no_code", req.url));
  }

  const sb = await supabaseServerCtx();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(
        `/auth/login?error=${encodeURIComponent(error.message)}`,
        req.url,
      ),
    );
  }

  // Consume pending invitations matching this user's email
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (user?.email) {
      const email = user.email.toLowerCase();
      const admin = supabaseAdmin();
      const { data: orgs } = await admin
        .from("organizations")
        .select("id, settings");

      for (const org of (orgs ?? []) as Array<{
        id: string;
        settings: Record<string, unknown> | null;
      }>) {
        const settings = org.settings ?? {};
        const pending = Array.isArray(settings.pending_invites)
          ? ((settings.pending_invites as string[]).map((e) => e.toLowerCase()))
          : [];
        if (!pending.includes(email)) continue;

        // Add membership (idempotent — onConflict)
        await admin.from("org_members").upsert(
          {
            org_id: org.id,
            user_id: user.id,
            role: "contributor",
          },
          { onConflict: "org_id,user_id" },
        );
        // Remove from pending
        await admin
          .from("organizations")
          .update({
            settings: {
              ...settings,
              pending_invites: pending.filter((e) => e !== email),
            },
          })
          .eq("id", org.id);
      }
    }
  } catch {
    // best-effort; auth still succeeded
  }

  return NextResponse.redirect(new URL(next, req.url));
}

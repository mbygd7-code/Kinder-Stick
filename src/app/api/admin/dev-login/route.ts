/**
 * Dev-only direct login — bypasses email AND Supabase external verify.
 *
 * Flow:
 *   1. Admin API generates magic link (returns hashed_token internally)
 *   2. Server-side calls verifyOtp({token_hash, type:'magiclink'}) directly
 *   3. Session cookies are attached to the redirect response
 *   4. User lands at /next with full session — no cross-origin dance
 *
 * Disabled in production (404).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const URL_ENV = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "disabled_in_production" },
      { status: 404 },
    );
  }

  const email = req.nextUrl.searchParams.get("email")?.trim();
  const next = req.nextUrl.searchParams.get("next") ?? "/me";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // 1. Generate the magic link (this also creates the user if missing).
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) {
    return NextResponse.json(
      { error: "generate_failed", detail: linkErr.message },
      { status: 502 },
    );
  }

  const tokenHash = linkData.properties.hashed_token;
  if (!tokenHash) {
    return NextResponse.json(
      { error: "missing_token_hash" },
      { status: 502 },
    );
  }

  // 2. Build the redirect response upfront so cookies attach to it.
  const response = NextResponse.redirect(new URL(next, req.url));

  const sb = createServerClient(URL_ENV(), ANON_KEY(), {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          response.cookies.set({ name, value, ...options });
        }
      },
    },
  });

  // 3. Verify the OTP server-side — exchanges the token_hash for a session
  //    AND triggers our cookies setAll callback.
  const { error: verifyErr } = await sb.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });

  if (verifyErr) {
    return NextResponse.json(
      { error: "verify_failed", detail: verifyErr.message },
      { status: 502 },
    );
  }

  // 4. Dev convenience — auto-add this user as a member of every existing
  //    organization so they immediately see prior workspaces in /me, /worklist,
  //    etc. (Production-disabled at top of route.)
  try {
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user?.id) {
      const { data: orgs } = await admin
        .from("organizations")
        .select("id");
      const rows = ((orgs ?? []) as Array<{ id: string }>).map((o) => ({
        org_id: o.id,
        user_id: user.id,
        role: "owner",
      }));
      if (rows.length > 0) {
        await admin
          .from("org_members")
          .upsert(rows, { onConflict: "org_id,user_id" });
      }
    }
  } catch {
    // best-effort — login still succeeded
  }

  return response;
}

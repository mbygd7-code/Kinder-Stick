/**
 * Dev-only magic link generator — bypasses email sending entirely.
 *
 * Calls Supabase admin's `generateLink({ type: 'magiclink' })` which returns
 * a working callback URL without dispatching email. Useful when:
 *   - The default Supabase email service is rate-limited (project-wide quota)
 *   - You need to test the magic-link flow repeatedly during development
 *
 * Disabled in production (NODE_ENV === 'production') to prevent abuse.
 */

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled_in_production" }, { status: 404 });
  }

  const email = req.nextUrl.searchParams.get("email")?.trim();
  const next = req.nextUrl.searchParams.get("next") ?? "/me";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const origin = req.nextUrl.origin;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  // 'magiclink' creates the user if they don't exist; 'recovery' would
  // require an existing user. We use 'magiclink' for dev convenience.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });

  if (error) {
    return NextResponse.json(
      { error: "generate_failed", detail: error.message },
      { status: 502 },
    );
  }

  // The callback link Supabase produces is the link the user would receive
  // via email. Click it (or auto-redirect) to authenticate.
  const link = data.properties.action_link;
  return NextResponse.json({ link, email });
}

/**
 * Auth-aware Supabase clients (cookie-bound for server components).
 * Use these for routes that need auth.uid(); use supabase/server.ts (anon
 * + service role) for endpoints that don't touch user identity.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Cookie-aware client for server components and route handlers.
 * Reads existing session cookies; can also write (e.g., during login flow).
 */
export async function supabaseServerCtx() {
  const cookieStore = await cookies();
  return createServerClient(URL(), ANON(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // server components can't set cookies; that's fine — middleware does.
        }
      },
    },
  });
}

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * Returns the authenticated user (or null for anonymous visitors).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const sb = await supabaseServerCtx();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

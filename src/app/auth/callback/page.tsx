"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Magic-link callback page — handles BOTH flows:
 *   - PKCE       : `?code=...` (signInWithOtp from /auth/login)
 *   - Implicit   : `#access_token=...&refresh_token=...&type=magiclink`
 *                  (auth.admin.generateLink, dev bypass)
 *
 * Both flows ultimately call into the browser Supabase client which writes
 * the session cookies that subsequent server components can read.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("초기화 중…");

  useEffect(() => {
    const next = params.get("next") ?? "/me";
    const code = params.get("code");
    const errorDescription = params.get("error_description");

    if (errorDescription) {
      setError(errorDescription);
      return;
    }

    const sb = createSupabaseBrowser();

    async function go() {
      try {
        // Path 1 — PKCE: ?code=
        if (code) {
          setStage("코드 교환 중…");
          const { error: e } = await sb.auth.exchangeCodeForSession(code);
          if (e) {
            setError(e.message);
            return;
          }
          await consumeInvites();
          router.replace(next);
          return;
        }

        // Path 2 — Implicit: #access_token=...
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash;
        const hp = new URLSearchParams(hash);
        const access_token = hp.get("access_token");
        const refresh_token = hp.get("refresh_token");
        const hashError = hp.get("error_description");
        if (hashError) {
          setError(hashError);
          return;
        }
        if (access_token && refresh_token) {
          setStage("세션 설정 중…");
          const { error: e } = await sb.auth.setSession({
            access_token,
            refresh_token,
          });
          if (e) {
            setError(e.message);
            return;
          }
          await consumeInvites();
          router.replace(next);
          return;
        }

        // Neither — likely arrived via direct URL or stale link
        setError("매직링크 토큰이 없습니다 (링크가 만료되었거나 잘못되었을 수 있습니다)");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    async function consumeInvites() {
      try {
        await fetch("/api/auth/consume-invites", { method: "POST" });
      } catch {
        // best-effort
      }
    }

    go();
  }, [params, router]);

  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <p className="kicker mb-2">Sign in</p>
        {error ? (
          <>
            <h1 className="font-display text-3xl leading-tight">
              로그인에 실패했습니다
            </h1>
            <p className="mt-3 text-sm text-signal-red font-mono break-words">
              ⚠ {error}
            </p>
            <div className="mt-6 flex justify-center gap-3 flex-wrap">
              <a href="/auth/login" className="btn-primary">
                다시 시도 →
              </a>
              <a href="/auth/dev" className="btn-secondary">
                Dev 우회
              </a>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl leading-tight">
              로그인 처리 중…
            </h1>
            <p className="mt-3 text-sm text-ink-soft">{stage}</p>
            <div className="mt-6 flex justify-center">
              <span className="inline-block w-3 h-3 bg-accent animate-pulse" />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

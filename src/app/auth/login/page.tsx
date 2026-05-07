"use client";

import { useState, useTransition } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

  function send() {
    setError(null);
    startTransition(async () => {
      const sb = createSupabaseBrowser();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: e } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (e) {
        setError(e.message);
        return;
      }
      setSent(true);
    });
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md w-full">
        <header className="mb-8">
          <p className="kicker mb-2">No. 12 · Sign in</p>
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight">
            Kinder Stick{" "}
            <span className="text-accent italic font-display">OS</span>
          </h1>
          <p className="mt-3 text-ink-soft text-sm">
            이메일로 매직링크를 받아 로그인합니다. 익명 워크스페이스 접근은
            이 단계가 필요 없습니다 — 직접 <a href="/diag" className="underline hover:text-accent">/diag</a> 로 가세요.
          </p>
        </header>

        {sent ? (
          <div className="area-card !border-signal-green bg-soft-green/30">
            <p className="kicker !text-signal-green mb-2">Check your inbox</p>
            <h2 className="font-display text-2xl leading-tight">
              <span className="font-mono text-base">{email}</span> 로 매직링크를
              보냈습니다.
            </h2>
            <p className="mt-3 text-sm text-ink-soft">
              메일이 안 오면 스팸 함을 확인하거나 다시 시도하세요.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="btn-secondary mt-5"
            >
              <span className="font-mono text-xs">←</span>
              다른 이메일로 시도
            </button>
          </div>
        ) : (
          <form
            className="area-card"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid && !pending) send();
            }}
          >
            <p className="kicker mb-3">Magic link</p>
            <label className="label-mono mb-1 block" htmlFor="email">
              이메일 주소
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="evidence-input"
              placeholder="you@example.com"
              required
            />
            {error ? (
              <p className="mt-2 font-mono text-xs text-signal-red">⚠ {error}</p>
            ) : null}
            <div className="mt-4 dotted-rule pt-4 flex flex-wrap gap-3 items-center justify-between">
              <a href="/diag" className="label-mono hover:text-ink">
                ← 익명 워크스페이스로
              </a>
              <button
                type="submit"
                disabled={!valid || pending}
                className="btn-primary disabled:opacity-50"
              >
                {pending ? "전송 중…" : "매직링크 보내기"}
                <span className="font-mono text-xs">→</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

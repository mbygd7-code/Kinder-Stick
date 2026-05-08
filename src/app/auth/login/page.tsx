"use client";

import { useState, useTransition } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

const DEV_AUTO_LOGIN_EMAIL = "anonymous@kinder-stick.dev";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [anonPending, setAnonPending] = useState(false);
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

  /**
   * Dev-only: auto-login via /api/admin/dev-login (server verifies OTP +
   * sets session cookies + redirects). No cross-origin Supabase dance.
   * In production the endpoint returns 404 → fallback /diag (anonymous).
   */
  function startAnon() {
    setError(null);
    setAnonPending(true);
    // Direct browser navigation — server endpoint will redirect us to /diag
    // with cookies attached.
    window.location.href = `/api/admin/dev-login?email=${encodeURIComponent(
      DEV_AUTO_LOGIN_EMAIL,
    )}&next=/diag`;
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md w-full">
        <header className="mb-6">
          <p className="kicker mb-2">No. 12 · Sign in</p>
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight">
            Kinder Stick{" "}
            <span className="text-accent italic font-display">OS</span>
          </h1>
          <p className="mt-3 text-ink-soft text-sm leading-relaxed">
            이메일 매직링크로 로그인합니다. 비밀번호 없이 클릭 한 번이면 됩니다.
          </p>
        </header>

        {!sent ? (
          <div className="mb-5 note-box text-xs leading-relaxed">
            <p className="font-medium text-ink mb-1">로그인하면 받는 것</p>
            <ul className="space-y-0.5">
              <li>· /me 대시보드 — 참여 중인 모든 워크스페이스 한눈에</li>
              <li>· 워크스페이스 claim — 본인 계정 소유로 잠금 + 멤버 관리</li>
              <li>· 이메일 알림 — 주간 디지스트·액션 마감 알림</li>
              <li>· 초대 자동 가입 — 본인 이메일이 초대 목록에 있으면 자동 멤버</li>
            </ul>
            <p className="mt-2 text-ink-soft">
              한 번 빠르게 진단만 받아보고 싶다면 로그인 없이{" "}
              <a href="/diag" className="underline hover:text-ink">
                /diag
              </a>
              로 가세요.
            </p>
          </div>
        ) : null}

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
              <button
                type="button"
                onClick={startAnon}
                disabled={anonPending}
                className="label-mono hover:text-ink disabled:opacity-50 text-left"
                title="개발 단계: dev 사용자로 자동 로그인 → 모든 페이지 접근"
              >
                {anonPending
                  ? "← dev 자동 로그인 중…"
                  : "← 익명 워크스페이스로 (dev 자동 로그인)"}
              </button>
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

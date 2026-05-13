"use client";

/**
 * Sign-in page — 커스텀 PIN 로그인.
 *
 * 흐름:
 *   1) 이메일 입력 (이전 사용 ID 호버 시 드롭다운)
 *   2) PIN 4자리 입력
 *   3) 로그인 성공 → next 또는 /me
 *
 * 재방문 편의:
 *   - localStorage 'kso_last_emails' 에 최근 사용 이메일 5개 보관 → ID 입력란 호버 시 노출
 *   - localStorage 'kso_last_email' (가장 최근) 이면 자동 prefill → PIN 만 입력
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PIN_PATTERN = /^\d{4}$/;
const LS_EMAILS = "kso_last_emails";
const LS_LAST = "kso_last_email";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [historyEmails, setHistoryEmails] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startPending] = useTransition();
  const pinRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLFormElement>(null);

  // localStorage 에서 이전 이메일 prefill
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_EMAILS);
      const list: string[] = raw ? JSON.parse(raw) : [];
      setHistoryEmails(list);
      const last = window.localStorage.getItem(LS_LAST);
      if (last && EMAIL_PATTERN.test(last)) {
        setEmail(last);
        // PIN 만 입력하면 되므로 PIN 으로 포커스
        setTimeout(() => pinRef.current?.focus(), 100);
      }
    } catch {}
  }, []);

  // 외부 클릭 시 history dropdown 닫기
  useEffect(() => {
    if (!showHistory) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showHistory]);

  const validEmail = EMAIL_PATTERN.test(email);
  const validPin = PIN_PATTERN.test(pin);

  function rememberEmail(e: string) {
    try {
      const raw = window.localStorage.getItem(LS_EMAILS);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const next = [e, ...list.filter((x) => x !== e)].slice(0, 5);
      window.localStorage.setItem(LS_EMAILS, JSON.stringify(next));
      window.localStorage.setItem(LS_LAST, e);
    } catch {}
  }

  function login() {
    setError(null);
    startPending(async () => {
      const res = await fetch("/api/auth/pin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.message ?? "로그인 실패");
        return;
      }
      rememberEmail(email);
      setSuccess(true);
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") ?? "/me";
      setTimeout(() => router.replace(next), 500);
    });
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md w-full">
        <header className="mb-6">
          <p className="kicker mb-2">No. 12 · 로그인 (Sign in)</p>
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight">
            Kinder Stick{" "}
            <span className="text-accent italic font-display">OS</span>
          </h1>
          <p className="mt-3 text-ink-soft text-sm leading-relaxed">
            이메일 + 4자리 PIN — 비밀번호는 짧고 외우기 쉬워야 매일 들어옵니다.
          </p>
        </header>

        {success ? (
          <div className="area-card !border-signal-green bg-soft-green/30">
            <p className="kicker !text-signal-green mb-2">로그인 성공</p>
            <h2 className="font-display text-2xl leading-tight">
              <span className="font-mono text-base">{email}</span>
            </h2>
            <p className="mt-3 text-sm text-ink-soft">잠시 후 이동합니다…</p>
          </div>
        ) : (
          <form
            ref={containerRef}
            className="area-card relative"
            onSubmit={(e) => {
              e.preventDefault();
              if (validEmail && validPin && !pending) login();
            }}
          >
            <p className="kicker mb-3">이메일 + PIN</p>

            {/* ── ID 입력란 (호버 시 이전 사용 ID 목록) ── */}
            <label className="label-mono mb-1 block" htmlFor="email">
              ID (이메일)
            </label>
            <div className="relative">
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim().toLowerCase())}
                onFocus={() =>
                  historyEmails.length > 0 && setShowHistory(true)
                }
                onMouseEnter={() =>
                  historyEmails.length > 0 && setShowHistory(true)
                }
                className="evidence-input"
                placeholder="you@example.com"
                required
              />
              {showHistory && historyEmails.length > 0 ? (
                <ul
                  role="listbox"
                  className="absolute z-20 left-0 right-0 top-full mt-1 border-2 border-ink bg-paper shadow-lg max-h-56 overflow-y-auto"
                >
                  <li className="px-3 py-2 label-mono border-b border-ink-soft/40 bg-paper-soft">
                    이 기기에서 사용한 ID
                  </li>
                  {historyEmails.map((e) => (
                    <li key={e}>
                      <button
                        type="button"
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          setEmail(e);
                          setShowHistory(false);
                          setTimeout(() => pinRef.current?.focus(), 50);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-paper-deep transition-colors font-mono"
                      >
                        {e}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* ── PIN 입력란 ── */}
            <label
              className="label-mono mb-1 mt-5 block"
              htmlFor="pin"
            >
              PIN (4자리 숫자)
            </label>
            <input
              ref={pinRef}
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              maxLength={4}
              pattern="\d{4}"
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="evidence-input !text-2xl !font-mono !tracking-[0.5em] !text-center"
              placeholder="••••"
              required
            />

            {error ? (
              <p className="mt-3 font-mono text-xs text-signal-red">
                ⚠ {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <a
                href="/auth/signup"
                className="label-mono hover:text-ink"
              >
                ← 신규 가입
              </a>
              <button
                type="submit"
                disabled={!validEmail || !validPin || pending}
                className="btn-primary disabled:opacity-50"
              >
                {pending ? "확인 중…" : "로그인"}
                <span className="font-mono text-xs">→</span>
              </button>
            </div>

            <div className="mt-5 pt-4 border-t border-ink-soft/30 text-xs leading-relaxed text-ink-soft">
              <p>
                · 5회 실패하면 15분간 잠깁니다.
              </p>
              <p>
                · 익명 진단을 원하면{" "}
                <a href="/diag" className="underline hover:text-ink">
                  /diag
                </a>{" "}
                로 가세요.
              </p>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

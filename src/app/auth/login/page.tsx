"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

const DEV_AUTO_LOGIN_EMAIL = "anonymous@kinder-stick.dev";

/**
 * Sign-in page — OTP 6자리 코드 우선, 매직링크 보조.
 *
 * 흐름:
 *  1. 이메일 입력 → "코드 받기" 클릭
 *  2. Supabase signInWithOtp 호출 → 이메일에 6자리 코드 발송
 *  3. 같은 페이지에서 6자리 코드 입력 → verifyOtp → 즉시 로그인 + redirect
 *
 * 호환성:
 *  - 사용자가 이메일의 매직링크를 클릭해도 동일 동작 (/auth/callback 처리)
 *  - 페이지를 떠나도 메일 받고 코드 복사 → 다시 와서 입력 가능
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, startSending] = useTransition();
  const [verifying, startVerifying] = useTransition();
  const [anonPending, setAnonPending] = useState(false);
  const [stage, setStage] = useState<"input" | "code" | "success">("input");
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const validCode = /^\d{6}$/.test(code.trim());

  // 코드 입력 단계로 전환 시 자동 포커스
  useEffect(() => {
    if (stage === "code" && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [stage]);

  // 재전송 쿨다운 (60초)
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(
      () => setResendCooldown((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  function sendCode() {
    setError(null);
    startSending(async () => {
      const sb = createSupabaseBrowser();
      // emailRedirectTo 를 두면 사용자가 메일의 매직링크 클릭도 가능.
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: e } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (e) {
        setError(e.message);
        return;
      }
      setStage("code");
      setResendCooldown(60);
    });
  }

  function verifyCode() {
    setError(null);
    startVerifying(async () => {
      const sb = createSupabaseBrowser();
      const { error: e } = await sb.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });
      if (e) {
        setError(e.message);
        return;
      }
      // 초대 자동 가입
      try {
        await fetch("/api/auth/consume-invites", { method: "POST" });
      } catch {
        // best-effort
      }
      setStage("success");
      // 약간의 시간 후 redirect — 사용자에게 success 잠깐 보여줌
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") ?? "/me";
      setTimeout(() => router.replace(next), 600);
    });
  }

  function startAnon() {
    setError(null);
    setAnonPending(true);
    window.location.href = `/api/admin/dev-login?email=${encodeURIComponent(
      DEV_AUTO_LOGIN_EMAIL,
    )}&next=/diag`;
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
            이메일로 6자리 코드를 받아 입력하면 바로 로그인됩니다. 비밀번호 불필요.
          </p>
        </header>

        {/* [TODO PRODUCTION] 인증 복원 시 이 dev 안내 박스 제거 */}
        <div className="mb-5 border-2 border-signal-amber bg-soft-amber/20 p-4">
          <p className="kicker !text-signal-amber mb-1">개발 모드</p>
          <p className="text-sm leading-relaxed">
            현재 로그인 없이 모든 진단 카드에 접근 가능합니다.{" "}
            <a href="/diag" className="underline font-medium hover:text-ink">
              /diag 로 바로 가기 →
            </a>
          </p>
          <p className="mt-2 label-mono">
            로그인은 인증 시스템 복원 후에만 필요합니다. 이 페이지에서 로그인해도
            동작하지만 개발 단계엔 필요 없습니다.
          </p>
        </div>

        {stage === "input" ? (
          <>
            <div className="mb-5 note-box text-xs leading-relaxed">
              <p className="font-medium text-ink mb-1">로그인하면 받는 것</p>
              <ul className="space-y-0.5">
                <li>· /me 대시보드 — 참여 중인 모든 진단 카드 한눈에</li>
                <li>· 진단 카드 claim — 본인 계정 소유로 잠금 + 멤버 관리</li>
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

            <form
              className="area-card"
              onSubmit={(e) => {
                e.preventDefault();
                if (validEmail && !pending) sendCode();
              }}
            >
              <p className="kicker mb-3">이메일 인증 (Email OTP)</p>
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
                <p className="mt-2 font-mono text-xs text-signal-red">
                  ⚠ {error}
                </p>
              ) : null}
              <div className="mt-4 dotted-rule pt-4 flex flex-wrap gap-3 items-center justify-between">
                <button
                  type="button"
                  onClick={startAnon}
                  disabled={anonPending}
                  className="label-mono hover:text-ink disabled:opacity-50 text-left"
                  title="개발 단계: dev 사용자로 자동 로그인"
                >
                  {anonPending
                    ? "← dev 자동 로그인 중…"
                    : "← 익명 진단 카드로 (dev 자동 로그인)"}
                </button>
                <button
                  type="submit"
                  disabled={!validEmail || pending}
                  className="btn-primary disabled:opacity-50"
                >
                  {pending ? "전송 중…" : "6자리 코드 받기"}
                  <span className="font-mono text-xs">→</span>
                </button>
              </div>
            </form>
          </>
        ) : null}

        {stage === "code" ? (
          <form
            className="area-card !border-accent"
            onSubmit={(e) => {
              e.preventDefault();
              if (validCode && !verifying) verifyCode();
            }}
          >
            <p className="kicker !text-accent mb-2">메일함 확인 (Check inbox)</p>
            <h2 className="font-display text-2xl leading-tight">
              <span className="font-mono text-base">{email}</span>
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              메일에 도착한 <strong>6자리 코드</strong>를 아래에 입력하거나,
              메일의 <strong>로그인 링크</strong>를 클릭하면 자동으로 로그인됩니다.
            </p>
            <div className="mt-3 note-box text-xs leading-relaxed">
              <p className="font-medium text-ink mb-1">메일에 6자리 코드가 안 보이면?</p>
              <ul className="space-y-0.5 text-ink-soft">
                <li>· 메일의 <strong>로그인 링크를 클릭</strong>하세요 — 자동 인증 후 같은 결과</li>
                <li>· 또는 운영자에게 Supabase 이메일 템플릿에 코드 변수 추가 요청 ({"{{ .Token }}"})</li>
              </ul>
            </div>

            <label
              className="label-mono mb-1 mt-5 block"
              htmlFor="otp-code"
            >
              6자리 코드
            </label>
            <input
              ref={codeInputRef}
              id="otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="evidence-input !text-2xl !font-mono !tracking-[0.4em] !text-center"
              placeholder="000000"
              required
            />
            {error ? (
              <p className="mt-2 font-mono text-xs text-signal-red">
                ⚠ {error}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setStage("input");
                  setCode("");
                  setError(null);
                }}
                className="label-mono hover:text-ink"
              >
                ← 다른 이메일로 시도
              </button>
              <button
                type="submit"
                disabled={!validCode || verifying}
                className="btn-primary disabled:opacity-50"
              >
                {verifying ? "확인 중…" : "로그인"}
                <span className="font-mono text-xs">→</span>
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-ink-soft/30 flex items-center justify-between gap-3 flex-wrap">
              <p className="label-mono">
                메일 안 옴? 스팸함 / 1–2분 후 다시 시도
              </p>
              <button
                type="button"
                onClick={() => {
                  if (resendCooldown === 0 && validEmail) sendCode();
                }}
                disabled={resendCooldown > 0 || pending}
                className="label-mono hover:text-ink disabled:opacity-50"
              >
                {pending
                  ? "재전송 중…"
                  : resendCooldown > 0
                    ? `재전송 (${resendCooldown}s)`
                    : "코드 다시 받기"}
              </button>
            </div>
          </form>
        ) : null}

        {stage === "success" ? (
          <div className="area-card !border-signal-green bg-soft-green/30">
            <p className="kicker !text-signal-green mb-2">로그인 성공</p>
            <h2 className="font-display text-2xl leading-tight">
              <span className="font-mono text-base">{email}</span>
            </h2>
            <p className="mt-3 text-sm text-ink-soft">
              잠시 후 자동으로 이동합니다…
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

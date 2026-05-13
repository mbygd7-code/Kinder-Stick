"use client";

/**
 * Sign-up page — 커스텀 PIN 회원가입.
 *
 * 필수: ID(이메일), PIN(4자리 숫자)
 * 선택: 팀명 (6개 enum), 표시이름
 *
 * 첫 사용자는 자동 admin (운영 편의)
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEAMS, TEAM_LABEL, type Team } from "@/lib/auth/pin";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PIN_PATTERN = /^\d{4}$/;
const LS_EMAILS = "kso_last_emails";
const LS_LAST = "kso_last_email";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [team, setTeam] = useState<Team | "">("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startPending] = useTransition();
  const pin2Ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (PIN_PATTERN.test(pin) && pin2.length === 0) {
      pin2Ref.current?.focus();
    }
  }, [pin, pin2.length]);

  const validEmail = EMAIL_PATTERN.test(email);
  const validPin = PIN_PATTERN.test(pin);
  const matched = pin === pin2 && validPin;

  function rememberEmail(e: string) {
    try {
      const raw = window.localStorage.getItem(LS_EMAILS);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const next = [e, ...list.filter((x) => x !== e)].slice(0, 5);
      window.localStorage.setItem(LS_EMAILS, JSON.stringify(next));
      window.localStorage.setItem(LS_LAST, e);
    } catch {}
  }

  function signup() {
    setError(null);
    startPending(async () => {
      const res = await fetch("/api/auth/pin/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          pin,
          team: team || undefined,
          display_name: displayName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.message ?? "가입 실패");
        return;
      }
      rememberEmail(email);
      setSuccess(true);
      setTimeout(() => router.replace("/me"), 600);
    });
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md w-full">
        <header className="mb-6">
          <p className="kicker mb-2">No. 13 · 신규 가입 (Sign up)</p>
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight">
            가입해서{" "}
            <span className="italic font-light">시작</span>
          </h1>
          <p className="mt-3 text-ink-soft text-sm leading-relaxed">
            이메일 + 4자리 숫자 PIN. 팀명은 선택 — 진단 응답이 어느 팀의
            시각인지 자동 태그됩니다.
          </p>
        </header>

        {success ? (
          <div className="area-card !border-signal-green bg-soft-green/30">
            <p className="kicker !text-signal-green mb-2">가입 완료</p>
            <h2 className="font-display text-2xl leading-tight">
              <span className="font-mono text-base">{email}</span>
            </h2>
            <p className="mt-3 text-sm text-ink-soft">
              자동으로 로그인되었습니다. /me 로 이동합니다…
            </p>
          </div>
        ) : (
          <form
            className="area-card"
            onSubmit={(e) => {
              e.preventDefault();
              if (validEmail && matched && !pending) signup();
            }}
          >
            <p className="kicker mb-3">계정 정보</p>

            <label className="label-mono mb-1 block" htmlFor="email">
              ID (이메일) <span className="text-signal-red">*</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim().toLowerCase())}
              className="evidence-input"
              placeholder="you@example.com"
              required
            />

            <label
              className="label-mono mb-1 mt-5 block"
              htmlFor="pin"
            >
              PIN (4자리 숫자) <span className="text-signal-red">*</span>
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
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

            <label
              className="label-mono mb-1 mt-3 block"
              htmlFor="pin2"
            >
              PIN 확인
            </label>
            <input
              ref={pin2Ref}
              id="pin2"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              pattern="\d{4}"
              value={pin2}
              onChange={(e) =>
                setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="evidence-input !text-2xl !font-mono !tracking-[0.5em] !text-center"
              placeholder="••••"
              required
            />
            {pin2.length === 4 && !matched ? (
              <p className="mt-2 label-mono !text-signal-red">
                PIN 이 일치하지 않습니다
              </p>
            ) : null}

            <div className="mt-6 pt-4 border-t border-ink-soft/30">
              <p className="kicker mb-3">팀·표시이름 (선택)</p>

              <label className="label-mono mb-1 block" htmlFor="team">
                소속 팀
              </label>
              <select
                id="team"
                value={team}
                onChange={(e) => setTeam(e.target.value as Team | "")}
                className="evidence-input"
              >
                <option value="">선택 안 함</option>
                {TEAMS.map((t) => (
                  <option key={t} value={t}>
                    {TEAM_LABEL[t]}
                  </option>
                ))}
              </select>
              <p className="mt-1 label-mono">
                선택하면 진단 응답이 이 팀 시각으로 태그됩니다. 안 고르면
                팀 무관 응답으로 저장.
              </p>

              <label
                className="label-mono mb-1 mt-4 block"
                htmlFor="display_name"
              >
                표시 이름
              </label>
              <input
                id="display_name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="evidence-input"
                placeholder="예: 김민지"
                maxLength={40}
              />
            </div>

            {error ? (
              <p className="mt-3 font-mono text-xs text-signal-red">
                ⚠ {error}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <a
                href="/auth/login"
                className="label-mono hover:text-ink"
              >
                ← 이미 가입했음
              </a>
              <button
                type="submit"
                disabled={!validEmail || !matched || pending}
                className="btn-primary disabled:opacity-50"
              >
                {pending ? "가입 중…" : "가입 + 로그인"}
                <span className="font-mono text-xs">→</span>
              </button>
            </div>

            <div className="mt-5 pt-4 border-t border-ink-soft/30 text-xs leading-relaxed text-ink-soft">
              <p>
                · 첫 가입자는 자동 관리자 권한 (다른 팀 응답까지 모두 조회).
              </p>
              <p>
                · 둘째부터는 팀 멤버 — 모든 진단을 볼 수 있지만 응답은 자기 팀 시각만.
              </p>
              <p>
                · 4자리 PIN 은 짧지만 5회 오답 시 15분 잠금으로 무차별 대입 방지.
              </p>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

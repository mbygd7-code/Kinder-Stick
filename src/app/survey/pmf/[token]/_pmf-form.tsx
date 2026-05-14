"use client";

/**
 * Sean Ellis PMF 3옵션 응답 폼.
 *
 * 옵션:
 *   1. 매우 실망스러울 것이다 (Very Disappointed) — high tone
 *   2. 다소 실망스러울 것이다 (Somewhat Disappointed) — mid tone
 *   3. 실망스럽지 않을 것이다 (Not Disappointed) — low tone
 *
 * VD% ≥ 40% 가 Sean Ellis PMF 임계.
 */

import { useState, useTransition } from "react";
import { ThanksScreen } from "../../_thanks";
import { PMF_OPTIONS } from "@/lib/surveys/types";

interface Props {
  token: string;
  title: string;
  question: string;
  reasonLabel: string;
}

export function PmfForm({ token, title, question, reasonLabel }: Props) {
  const [choice, setChoice] = useState<1 | 2 | 3 | null>(null);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  function submit() {
    if (choice === null) return;
    setError(null);
    startPending(async () => {
      const res = await fetch(`/api/surveys/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pmf_choice: choice,
          reason: reason.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.message ?? "제출 실패");
        return;
      }
      setSubmitted(true);
    });
  }

  if (submitted) {
    return (
      <ThanksScreen
        message={
          choice === 1
            ? "여러분의 응답이 우리 서비스가 사용자에게 진짜로 필요하다는 신호입니다 — 감사합니다."
            : "솔직한 응답 감사합니다. 어떻게 더 도움될 수 있을지 고민하겠습니다."
        }
      />
    );
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-6 sm:p-10">
      <div className="max-w-2xl w-full">
        <header className="mb-8 text-center">
          <p className="kicker mb-2">{title}</p>
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">
            {question}
          </h1>
        </header>

        <div className="space-y-3 mb-8">
          {PMF_OPTIONS.map((opt) => {
            const isSelected = choice === opt.value;
            const toneColor =
              opt.tone === "high"
                ? "border-signal-green"
                : opt.tone === "mid"
                  ? "border-cobalt"
                  : "border-ink-soft/60";
            const selectedBg =
              opt.tone === "high"
                ? "bg-soft-green border-signal-green"
                : opt.tone === "mid"
                  ? "bg-soft-cobalt/40 border-cobalt"
                  : "bg-paper-deep border-ink";
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setChoice(opt.value as 1 | 2 | 3)}
                aria-pressed={isSelected}
                className={`w-full text-left border-2 p-5 sm:p-6 transition-colors ${
                  isSelected
                    ? selectedBg
                    : `${toneColor} hover:bg-paper-deep`
                }`}
              >
                <div className="flex items-baseline gap-3">
                  <span
                    className={`w-7 h-7 flex items-center justify-center border-2 font-mono text-sm shrink-0 ${
                      isSelected
                        ? "border-ink bg-ink text-paper"
                        : "border-ink-soft"
                    }`}
                  >
                    {opt.value}
                  </span>
                  <span className="font-display text-lg sm:text-xl leading-tight">
                    {opt.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <label className="label-mono mb-1 block" htmlFor="reason">
          {reasonLabel}
        </label>
        <textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          className="evidence-input"
          placeholder="자유롭게 적어주세요 (선택 입력)"
        />
        <p className="mt-1 label-mono text-ink-soft text-right">
          {reason.length} / 500
        </p>

        {error ? (
          <p className="mt-3 font-mono text-xs text-signal-red text-center">
            ⚠ {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={submit}
            disabled={choice === null || pending}
            className="btn-primary disabled:opacity-50 text-base"
          >
            {pending ? "제출 중…" : "제출"}
            <span className="font-mono text-xs">→</span>
          </button>
        </div>

        <p className="mt-8 label-mono text-ink-soft text-center">
          익명 응답입니다.
        </p>
      </div>
    </main>
  );
}

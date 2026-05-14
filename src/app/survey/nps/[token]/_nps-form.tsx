"use client";

/**
 * NPS 11점 척도 응답 폼.
 *
 * 디자인:
 *   - 0(전혀) ~ 10(매우) 11개 큰 버튼 가로 grid
 *   - 0-6 빨강 / 7-8 회색 / 9-10 초록 (Bain NPS color)
 *   - 선택 후 이유 텍스트 (선택 입력)
 *   - 제출 → ThanksScreen
 */

import { useState, useTransition } from "react";
import { ThanksScreen } from "../../_thanks";

interface Props {
  token: string;
  title: string;
  question: string;
  reasonLabel: string;
}

function tone(n: number) {
  if (n >= 9) return "promoter"; // green
  if (n >= 7) return "passive"; // gray
  return "detractor"; // red
}

export function NpsForm({ token, title, question, reasonLabel }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  function submit() {
    if (score === null) return;
    setError(null);
    startPending(async () => {
      const res = await fetch(`/api/surveys/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, reason: reason.trim() || null }),
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
        message={`NPS 응답이 저장되었습니다. ${
          score !== null && score >= 9
            ? "응원해 주셔서 감사합니다 — 더 좋은 도구로 보답하겠습니다."
            : score !== null && score <= 6
              ? "솔직한 피드백 감사합니다. 개선하겠습니다."
              : "참여 감사합니다."
        }`}
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
          <p className="mt-3 label-mono text-ink-soft">
            0 = 전혀 그렇지 않음 · 10 = 매우 그러함
          </p>
        </header>

        {/* 11점 척도 */}
        <div className="grid grid-cols-11 gap-1 sm:gap-2 mb-2">
          {Array.from({ length: 11 }, (_, i) => i).map((n) => {
            const t = tone(n);
            const isSelected = score === n;
            const baseColor =
              t === "promoter"
                ? "border-signal-green hover:bg-soft-green"
                : t === "passive"
                  ? "border-ink-soft/60 hover:bg-paper-deep"
                  : "border-signal-red hover:bg-soft-red";
            const selectedColor =
              t === "promoter"
                ? "bg-signal-green text-paper border-signal-green"
                : t === "passive"
                  ? "bg-ink-soft text-paper border-ink-soft"
                  : "bg-signal-red text-paper border-signal-red";
            return (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`aspect-square border-2 font-display text-lg sm:text-2xl transition-colors ${
                  isSelected ? selectedColor : baseColor
                }`}
                aria-pressed={isSelected}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-11 mb-8">
          <span className="col-span-3 label-mono">반대</span>
          <span className="col-span-5 label-mono text-center">중립</span>
          <span className="col-span-3 label-mono text-right">추천</span>
        </div>

        {/* 이유 입력 (선택) */}
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
            disabled={score === null || pending}
            className="btn-primary disabled:opacity-50 text-base"
          >
            {pending ? "제출 중…" : "제출"}
            <span className="font-mono text-xs">→</span>
          </button>
        </div>

        <p className="mt-8 label-mono text-ink-soft text-center">
          익명 응답 — 누가 어떤 점수를 선택했는지 운영진은 알 수 없습니다.
        </p>
      </div>
    </main>
  );
}

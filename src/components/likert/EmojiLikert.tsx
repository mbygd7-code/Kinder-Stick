"use client";

/**
 * EmojiLikert — 이모지 5점 척도 컴포넌트 (Appendix G).
 *
 * 직원이 익숙한 표정 이모지로 직관 응답.
 * 1=😟 모름 — 2=🤔 들어봤음 — 3=😐 보통 — 4=🙂 잘함 — 5=😀 매우 잘함
 *
 * 사용:
 *   <EmojiLikert value={3} onChange={setValue} />
 *   <EmojiLikert value={belief} onChange={(v) => set(...)} variant="belief" />
 *
 * variant: 응답 의미에 따라 라벨 변경
 *   "belief"   — 스스로 평가 ("모름…매우 잘함")
 *   "evidence" — 근거 점수 ("측정 안 함…정기 측정")
 *   "agree"    — 동의도 ("전혀 아니다…매우 그렇다")
 */

import { useState } from "react";

type Variant = "belief" | "evidence" | "agree";

interface OptionDef {
  v: 1 | 2 | 3 | 4 | 5;
  emoji: string;
  label: string;
  meaning: string;
}

const VARIANT_OPTIONS: Record<Variant, OptionDef[]> = {
  belief: [
    { v: 1, emoji: "😟", label: "모름", meaning: "이 항목이 뭔지 잘 모름" },
    { v: 2, emoji: "🤔", label: "들어봤음", meaning: "들어봤지만 안 챙김" },
    { v: 3, emoji: "😐", label: "보통", meaning: "한 번 챙겼지만 정기 관리 안 함" },
    { v: 4, emoji: "🙂", label: "잘함", meaning: "정기적으로 챙기고 있음" },
    { v: 5, emoji: "😀", label: "매우 잘함", meaning: "지표로 추적·개선 중" },
  ],
  evidence: [
    { v: 1, emoji: "😟", label: "측정 안 함", meaning: "근거 데이터 없음" },
    { v: 2, emoji: "🤔", label: "감으로만", meaning: "정성적 추정만" },
    { v: 3, emoji: "😐", label: "1회 측정", meaning: "과거 1번 측정한 적 있음" },
    { v: 4, emoji: "🙂", label: "주기적 측정", meaning: "정기적으로 측정 중" },
    { v: 5, emoji: "😀", label: "자동 추적", meaning: "KPI 연동·자동 alerting" },
  ],
  agree: [
    { v: 1, emoji: "😟", label: "전혀 아니다", meaning: "" },
    { v: 2, emoji: "🤔", label: "아니다", meaning: "" },
    { v: 3, emoji: "😐", label: "보통", meaning: "" },
    { v: 4, emoji: "🙂", label: "그렇다", meaning: "" },
    { v: 5, emoji: "😀", label: "매우 그렇다", meaning: "" },
  ],
};

export interface EmojiLikertProps {
  value: 1 | 2 | 3 | 4 | 5 | null;
  onChange: (v: 1 | 2 | 3 | 4 | 5) => void;
  variant?: Variant;
  /** 'N/A' (측정 안 함) 옵션 노출 — evidence variant 에서 주로 사용 */
  showNotApplicable?: boolean;
  onNotApplicable?: () => void;
  notApplicable?: boolean;
  disabled?: boolean;
  /** 응답 라벨 (호버 시 표시) 사용자 설명용 */
  hint?: string;
}

export function EmojiLikert({
  value,
  onChange,
  variant = "belief",
  showNotApplicable = false,
  onNotApplicable,
  notApplicable = false,
  disabled = false,
  hint,
}: EmojiLikertProps) {
  const opts = VARIANT_OPTIONS[variant];
  const [hovered, setHovered] = useState<number | null>(null);

  const active = hovered ?? value ?? 0;

  return (
    <div className="w-full">
      <div className="grid grid-cols-5 gap-2" role="radiogroup">
        {opts.map((opt) => {
          const selected = value === opt.v && !notApplicable;
          const isActive = active === opt.v;
          return (
            <button
              key={opt.v}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.v)}
              onMouseEnter={() => setHovered(opt.v)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(opt.v)}
              onBlur={() => setHovered(null)}
              className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 border-2 transition-all
                ${
                  selected
                    ? "border-accent bg-accent/10"
                    : isActive
                      ? "border-ink bg-paper-deep/50"
                      : "border-ink-soft/40 bg-paper hover:border-ink-soft"
                }
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              `}
              title={opt.meaning}
            >
              <span
                className={`text-3xl leading-none transition-transform ${
                  selected ? "scale-110" : ""
                }`}
                aria-hidden="true"
              >
                {opt.emoji}
              </span>
              <span
                className={`text-xs font-medium leading-tight ${
                  selected ? "text-ink" : "text-ink-soft"
                }`}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 호버 또는 선택 시 의미 풀이 */}
      {(hovered !== null || value !== null) && active !== 0 ? (
        <p className="mt-2 label-mono text-center leading-relaxed">
          {opts.find((o) => o.v === active)?.meaning}
        </p>
      ) : null}

      {/* N/A 옵션 (evidence 응답용) */}
      {showNotApplicable ? (
        <div className="mt-3 flex items-center justify-center">
          <button
            type="button"
            onClick={onNotApplicable}
            disabled={disabled}
            className={`label-mono px-3 py-1 border transition-colors ${
              notApplicable
                ? "border-ink bg-paper-deep/50 text-ink"
                : "border-ink-soft/40 hover:border-ink-soft"
            }`}
          >
            {notApplicable ? "✓ 측정 안 함" : "측정 안 함 (N/A)"}
          </button>
        </div>
      ) : null}

      {hint ? (
        <p className="mt-2 label-mono text-center">{hint}</p>
      ) : null}
    </div>
  );
}

"use client";

/**
 * PinField — 4자리 PIN 입력 + 눈 아이콘 토글.
 *
 * 사용 (controlled):
 *   <PinField id="cur_pin" label="현재 PIN" value={curPin} onChange={setCurPin} />
 *
 * 특징:
 *   - 기본 type="password" — 항상 숨김 상태로 시작 (보안 기본값)
 *   - 우측 eye 버튼 클릭 시 type="text" 로 일시 전환
 *   - blur (포커스 떠남) 시 자동으로 다시 숨김 처리 (실수로 화면에 남는 거 방지)
 *   - 숫자 외 입력 자동 제거, maxLength 4
 *   - 라벨/도움말 텍스트 통합 — settings/login/signup 일관성
 */

import { useEffect, useState } from "react";

interface Props {
  id: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: "current-password" | "new-password" | "off";
  placeholder?: string;
  required?: boolean;
  /** size variant */
  size?: "md" | "lg";
  /** Tailwind className 추가 — 너비 제한 등 */
  className?: string;
  /** 부모가 ref 가 필요한 경우 직접 input id 로 찾기 */
}

export function PinField({
  id,
  label,
  value,
  onChange,
  autoComplete = "current-password",
  placeholder,
  required,
  size = "md",
  className,
}: Props) {
  // 기본값은 항상 히든 — 사용자가 명시적으로 눈을 켜야만 표시.
  const [visible, setVisible] = useState(false);

  // 추가 안전장치: 입력란이 포커스를 잃으면 자동으로 다시 히든으로 복귀.
  // 사용자가 PIN 을 노출한 채로 자리를 비울 위험을 줄임.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = document.getElementById(id);
    if (!el) return;
    const onBlur = () => setVisible(false);
    el.addEventListener("blur", onBlur);
    return () => el.removeEventListener("blur", onBlur);
  }, [id]);

  const textSize = size === "lg" ? "!text-2xl" : "!text-xl";

  // placeholder 가 visibility 에 따라 다르게 보여야 사용자가 입력 상태를
  // 명확히 인지 — 숨김 모드에서는 마스크 닷, 표시 모드에서는 dash 가이드.
  const effectivePlaceholder =
    placeholder ?? (visible ? "0 0 0 0" : "••••");

  return (
    <div className={className}>
      {label ? (
        <label
          className="label-mono mb-1 flex items-center justify-between gap-2"
          htmlFor={id}
        >
          <span>{label}</span>
          {visible ? (
            <span className="!normal-case tracking-normal text-accent">
              표시 중
            </span>
          ) : null}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          inputMode="numeric"
          autoComplete={autoComplete}
          maxLength={4}
          pattern="\d{4}"
          value={value}
          onChange={(e) =>
            onChange(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          className={`evidence-input ${textSize} !font-mono !tracking-[0.5em] !text-center pr-11 ${
            visible ? "!text-accent" : ""
          }`}
          placeholder={effectivePlaceholder}
          required={required}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className={`absolute top-1/2 -translate-y-1/2 right-2 w-7 h-7 flex items-center justify-center border transition-colors ${
            visible
              ? "border-accent text-accent bg-soft-amber/30"
              : "border-ink-soft/40 hover:border-ink hover:bg-paper-deep text-ink-soft"
          }`}
          aria-label={visible ? "PIN 숨기기" : "PIN 보기"}
          aria-pressed={visible}
          title={visible ? "PIN 숨기기" : "PIN 보기"}
          tabIndex={-1}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

"use client";

/**
 * TermTooltip — 호버 시 평이한 풀이 노출.
 *
 * 사용:
 *   <Term k="PMF" />                      // "제품-시장 적합성 (PMF)"
 *   <Term k="PMF" form="friendly" />     // "제품-시장 적합성"
 *   <Term k="PMF" form="full" />         // "제품-시장 적합성 (PMF · Product-Market Fit)"
 *   <Term k="PMF">사용자 만족</Term>     // children 우선, 호버 시 PMF 풀이
 */

import { findTerm, withProfessional, friendly } from "@/lib/term-glossary";
import { useState } from "react";

interface TermProps {
  /** Glossary 키 (대소문자·공백 무시) */
  k: string;
  /** 표시 형태 — friendly (한국어만) / paren (한국어+괄호 약식) / full (한국어+괄호 풀) */
  form?: "friendly" | "paren" | "full";
  /** children 으로 직접 표시 텍스트 지정 시 — 우선 노출 */
  children?: React.ReactNode;
  className?: string;
}

export function Term({ k, form = "paren", children, className }: TermProps) {
  const [open, setOpen] = useState(false);
  const entry = findTerm(k);

  let displayText: React.ReactNode = children;
  if (!displayText) {
    if (!entry) {
      displayText = k;
    } else if (form === "friendly") {
      displayText = entry.friendly;
    } else if (form === "full") {
      displayText = `${entry.friendly} (${entry.professional})`;
    } else {
      // paren: "한국어 (약식 전문용어)" — professional 의 첫 토큰만
      const shortPro = entry.professional.split(/[·\s]/)[0];
      displayText = `${entry.friendly} (${shortPro})`;
    }
  }

  if (!entry) {
    return <span className={className}>{displayText}</span>;
  }

  return (
    <span
      className={`relative inline-flex items-baseline cursor-help border-b border-dotted border-ink-soft/60 ${className ?? ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {displayText}
      {open ? (
        <span
          role="tooltip"
          className="absolute left-0 bottom-full mb-1 z-50 w-72 bg-ink text-paper text-sm leading-relaxed p-3 shadow-lg border-2 border-ink"
          style={{ pointerEvents: "none" }}
        >
          <span className="block label-mono !text-paper-soft mb-1">
            {entry.professional}
          </span>
          <span className="block">{entry.explain}</span>
          {entry.link ? (
            <span className="block mt-2 label-mono !text-paper-soft">
              더 알아보기 → {entry.link}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 짧은 helper — 단순 텍스트 노출 시 (호버 없이).
 */
export function termText(k: string): string {
  return withProfessional(k);
}

export { friendly };

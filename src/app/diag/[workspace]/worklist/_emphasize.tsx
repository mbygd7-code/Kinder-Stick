/**
 * Emphasize — 워크리스트 본문 텍스트에서 직원이 빠르게 스캐닝할 수 있도록
 * **수치·기간·핵심 약어**를 자동으로 굵게/크게 강조한다.
 *
 * 매칭 패턴 (단일 통합 regex, 그룹으로 분기):
 *  1) 부호 있는 퍼센트:   "+30.8%", "-39.4%", "12%"
 *  2) 부호 있는 화살표 + 수치: "▲ 5", "▼ -807" 같은 모양은 별도 처리
 *  3) 통화·수량 단위:     "1,500원", "5만원", "12개월", "3주", "8명", "200회"
 *  4) 시간 약어:          "D1", "D7", "M1", "M3", "M6"
 *  5) 대문자 비즈니스 약어: PMF, JTBD, CAC, LTV, MAU, WAU, DAU, NPS, ROI,
 *     SEO, GTM, CTA, API, KPI, NRR, ICP, CS, UX, UI, AOV, LCM
 *
 * 강조는 `<strong class="font-semibold text-ink">…</strong>` 으로 감싸서 색을
 * 한 단계 진하게 + 굵게 만든다. (부모 텍스트가 text-ink-soft 일 때 대비가 큼)
 */

import type { ReactNode } from "react";

// 우선순위 — 더 긴/구체적인 패턴이 먼저 매칭되도록.
const PATTERN = new RegExp(
  [
    // 부호 있는 퍼센트 (예: +30.8%, -39.4%, 12%)
    "[+\\-▲▼↑↓]?\\s?\\d+(?:[.,]\\d+)?\\s?%",
    // 통화·수량 단위 (한글 단위 포함)
    "\\d+(?:[.,]\\d{1,3})*\\s?(?:원|만원|억원|억|만|명|회|건|개월|개|시간|일|주|달|년|MB|GB|KB|km|m)",
    // 시간 약어 D1/D7/D30/M1/M3/M6
    "\\b[DM]\\d{1,3}\\b",
    // 대문자 비즈니스 약어
    "\\b(?:PMF|JTBD|CAC|LTV|MAU|WAU|DAU|NPS|ROI|SEO|GTM|CTA|API|KPI|NRR|ICP|CS|UX|UI|AOV|LCM|MRR|ARR|ARPU|TAM|SAM|SOM|OKR|RAG)\\b",
  ].join("|"),
  "g",
);

export function Emphasize({ text }: { text: string }): ReactNode {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    }
    parts.push(
      <strong
        key={key++}
        className="font-semibold text-ink tabular-nums"
      >
        {m[0]}
      </strong>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) PATTERN.lastIndex++; // safety
  }
  if (last < text.length) {
    parts.push(<span key={key++}>{text.slice(last)}</span>);
  }
  return <>{parts}</>;
}

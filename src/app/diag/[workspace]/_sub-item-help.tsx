"use client";

/**
 * SubItemHelpPopover — 진단 sub-item 카드 우측 상단의 "?" 버튼.
 *
 * 워크리스트 task 카드의 TaskDescriptionPopover 와 동일한 UX 패턴.
 * 어려운 용어·전문용어·프레임워크 출처·측정 방법·왜 중요한지를 한 자리에서 보여준다.
 *
 * 데이터 소스:
 *   - sub.code, tier, domain, group — framework loader
 *   - sub.belief.q / belief.help / belief.anchors — 문항 본문
 *   - sub.evidence.q / evidence.options / evidence.kpi_source / evidence.refresh_period_days
 *   - sub.citation — 외부 프레임워크 인용 (예: "Ellis 2009; OpenView 2025 PMF playbook")
 *   - sub.failure_trigger — 빨강 trigger 조건
 *   - sub.cadence — 점검 주기
 *   - GLOSSARY 매칭 — 본문에 나오는 어려운 용어 자동 풀이
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Domain, SubItem } from "@/lib/framework/loader";
import { GLOSSARY, type TermEntry } from "@/lib/term-glossary";

interface Props {
  sub: SubItem;
  domain: Domain;
}

const TIER_LABEL: Record<SubItem["tier"], string> = {
  critical: "영향도 큼",
  important: "영향도 보통",
  supporting: "영향도 작음",
};

const CADENCE_LABEL: Record<string, string> = {
  daily: "매일 점검",
  weekly: "주간 점검",
  monthly: "월간 점검",
  quarterly: "분기 점검",
  semi_annual: "반기 점검",
  annual: "연간 점검",
  as_needed: "필요할 때",
};

/** 사전에 등록된 용어를 본문에서 자동 감지 (간단한 substring 매칭). */
function detectGlossaryTerms(...texts: (string | undefined)[]): Array<{
  key: string;
  entry: TermEntry;
}> {
  const joined = texts.filter(Boolean).join(" \n ");
  const hits: Array<{ key: string; entry: TermEntry }> = [];
  for (const key of Object.keys(GLOSSARY)) {
    const entry = GLOSSARY[key];
    // 키 OR 전문용어 OR 평이한 한국어 OR 영문 약어 매칭
    const candidates = [
      key,
      entry.professional,
      entry.friendly,
    ].filter(Boolean);
    for (const cand of candidates) {
      if (cand.length < 2) continue;
      if (joined.includes(cand)) {
        hits.push({ key, entry });
        break;
      }
    }
  }
  // 중복 제거 (같은 key 가 여러번 등장)
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (seen.has(h.key)) return false;
    seen.add(h.key);
    return true;
  });
}

export function SubItemHelpPopover({ sub, domain }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 본문에서 사전 매칭 — open 시점에만 계산
  const matchedTerms = useMemo(() => {
    if (!open) return [];
    return detectGlossaryTerms(
      sub.belief.q,
      sub.belief.help,
      sub.evidence.q,
      sub.citation,
      sub.failure_trigger,
      domain.name_ko,
      domain.framework,
    );
  }, [open, sub, domain]);

  // 외부 클릭 + ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current && containerRef.current.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cadenceLabel =
    CADENCE_LABEL[sub.cadence] ?? sub.cadence ?? "분기 점검";

  return (
    <div ref={containerRef} className="shrink-0 relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-6 h-6 flex items-center justify-center rounded-full border transition-colors text-xs font-mono ${
          open
            ? "border-ink bg-ink text-paper"
            : "border-ink-soft/40 text-ink-soft hover:border-ink hover:bg-paper-deep hover:text-ink"
        }`}
        title="이 문항이 무엇을 묻는지 — 용어 풀이 + 측정 방법"
        aria-label="문항 도움말 보기"
        aria-expanded={open}
      >
        ?
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="false"
          className="fixed sm:absolute sm:right-0 sm:top-7 inset-x-2 sm:inset-x-auto top-16 sm:top-7 z-30 w-auto sm:w-[36rem] lg:w-[40rem] max-h-[80vh] overflow-y-auto bg-paper border-2 border-ink shadow-2xl"
        >
          {/* ── Header ───────────────────────────────────────── */}
          <header className="sticky top-0 bg-paper border-b-2 border-ink px-5 py-3 flex items-center justify-between gap-3 flex-wrap z-10">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-xs text-ink-soft">{sub.code}</span>
              <span className="kicker">{TIER_LABEL[sub.tier]}</span>
              <span className="label-mono">{cadenceLabel}</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="label-mono hover:text-ink"
              aria-label="닫기"
            >
              닫기
            </button>
          </header>

          <div className="px-5 py-5 space-y-6">
            {/* 1. 어느 영역의 문항인가 */}
            <section>
              <p className="kicker mb-1">이 문항은 어느 영역인가</p>
              <p className="font-display text-lg leading-tight">
                {domain.name_ko}{" "}
                <span className="text-ink-soft text-sm">
                  ({domain.code} · 가중치 {domain.weight}%)
                </span>
              </p>
              {domain.framework ? (
                <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                  근거 프레임워크: {domain.framework}
                </p>
              ) : null}
            </section>

            {/* 2. 무엇을 묻나 */}
            <section className="border-l-2 border-ink-soft/40 pl-4 py-1">
              <p className="kicker mb-2">자기 평가 — 질문</p>
              <p className="text-base leading-relaxed">{sub.belief.q}</p>
              {sub.belief.help ? (
                <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                  ↳ {sub.belief.help}
                </p>
              ) : null}
              <p className="mt-3 label-mono">
                응답: 1 (전혀) — 5 (매우) · 안 5단계 척도
              </p>
            </section>

            <section className="border-l-2 border-ink-soft/40 pl-4 py-1">
              <p className="kicker mb-2">측정 — 근거 데이터</p>
              <p className="text-base leading-relaxed">{sub.evidence.q}</p>
              {sub.evidence.kpi_source ? (
                <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                  ↳ 자동 측정 가능:{" "}
                  <span className="font-mono">{sub.evidence.kpi_source}</span>
                </p>
              ) : null}
              {sub.evidence.refresh_period_days ? (
                <p className="mt-1 label-mono">
                  데이터 갱신 주기 {sub.evidence.refresh_period_days}일
                  {sub.evidence.refresh_period_days >= 90
                    ? " (분기마다 재측정 권장)"
                    : ""}
                </p>
              ) : null}
            </section>

            {/* 3. 빨강 trigger */}
            {sub.failure_trigger ? (
              <section className="border-l-4 border-signal-red pl-4 py-1 bg-soft-red/10">
                <p className="kicker !text-signal-red mb-1">빨강 위험 조건</p>
                <p className="text-sm leading-relaxed">
                  <span className="font-mono text-xs">
                    {sub.failure_trigger}
                  </span>
                </p>
                <p className="mt-1 label-mono">
                  이 조건이 충족되면 영역 점수가 빨강으로 떨어지고 코치 세션이
                  자동 트리거됩니다.
                </p>
              </section>
            ) : null}

            {/* 4. 용어 풀이 — 본문에서 자동 감지 */}
            {matchedTerms.length > 0 ? (
              <section>
                <p className="kicker mb-3">용어 풀이</p>
                <dl className="divide-y divide-ink-soft/30 border-y border-ink-soft/30">
                  {matchedTerms.map(({ key, entry }) => (
                    <div key={key} className="py-3">
                      <dt className="font-display text-base leading-tight">
                        {entry.friendly}{" "}
                        <span className="text-ink-soft text-sm font-mono">
                          ({entry.professional})
                        </span>
                      </dt>
                      <dd className="mt-1 text-sm text-ink-soft leading-relaxed">
                        {entry.explain}
                      </dd>
                      {entry.link ? (
                        <a
                          href={entry.link}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 inline-block label-mono hover:text-ink underline-offset-2 hover:underline"
                        >
                          더 알아보기 →
                        </a>
                      ) : null}
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {/* 5. 출처 (citation) */}
            {sub.citation ? (
              <section>
                <p className="kicker mb-1">출처 · 참고 자료</p>
                <p className="text-sm text-ink-soft leading-relaxed">
                  {sub.citation}
                </p>
              </section>
            ) : null}

            {/* 6. 응답이 어렵다면 */}
            <section className="bg-paper-soft/40 -mx-5 px-5 py-4 border-t border-ink-soft/30">
              <p className="kicker mb-1">응답이 어렵다면</p>
              <p className="text-sm leading-relaxed">
                실측 데이터가 없으면 <strong>“측정/기록 없음”</strong> 을
                선택하세요. 자가 평가(1–5점) 만으로도 진단이 진행됩니다. 단,
                실측 데이터 없으면 ‘데이터 품질’ 요인이 어려움 가능성을 약간
                올립니다 — 다음 분기까지 측정 체계를 만드는 게 가장 큰
                개선입니다.
              </p>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

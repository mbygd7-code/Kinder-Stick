"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CADENCE_LABEL, type Cadence, type Tier } from "@/lib/worklist/catalog";

interface Props {
  description?: string;
  why: string;
  hint?: string;
  ai_leverage?: string;
  escalation_hint?: string;
  cadence: Cadence;
  tier: Tier;
  domain?: string;
}

/**
 * Click-outside-to-close popover for task descriptions.
 *   - Click ? → toggle open
 *   - Click inside popover → stays open
 *   - Click anywhere else (other buttons, background, other tasks) → close
 *   - Esc → close
 */
export function TaskDescriptionPopover({
  description,
  why,
  hint,
  ai_leverage,
  escalation_hint,
  cadence,
  tier,
  domain,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function escHandler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open]);

  const tierLabel =
    tier === "must" ? "필수" : tier === "conditional" ? "조건부" : "정기";

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
        title="자세한 설명 보기"
        aria-label="자세한 설명 보기"
        aria-expanded={open}
      >
        ?
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="false"
          className="absolute right-0 top-7 z-30 w-80 sm:w-[28rem] max-h-[28rem] overflow-y-auto p-5 bg-paper border-2 border-ink shadow-lg text-sm leading-relaxed text-ink"
        >
          <div className="flex items-baseline justify-between gap-2 mb-3 pb-2 border-b border-ink-soft/30">
            <p className="kicker">자세한 설명</p>
            <p className="label-mono">
              {CADENCE_LABEL[cadence]} · {tierLabel}
              {domain ? ` · ${domain}` : ""}
            </p>
          </div>
          {description ? (
            <Description text={description} />
          ) : (
            <FallbackContent
              why={why}
              hint={hint}
              ai_leverage={ai_leverage}
              escalation_hint={escalation_hint}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders task.description with light formatting:
 *   - Lines starting with "ⓘ", "⚙", "✔" are rendered as section headers
 *   - Blank line = paragraph break
 */
function Description({ text }: { text: string }) {
  // Split into sections at section markers
  const sections = splitSections(text);
  return (
    <div className="space-y-3">
      {sections.map((s, i) =>
        s.heading ? (
          <div key={i}>
            <p className="kicker !text-ink mb-1.5">
              {s.heading.icon} {s.heading.label}
            </p>
            <p className="text-[13px] leading-[1.7] whitespace-pre-line">
              {s.body}
            </p>
          </div>
        ) : (
          <p
            key={i}
            className="text-[13px] leading-[1.7] whitespace-pre-line"
          >
            {s.body}
          </p>
        ),
      )}
    </div>
  );
}

interface Section {
  heading?: { icon: string; label: string };
  body: string;
}

const HEADING_ICONS = ["ⓘ", "⚙", "✔"];

function splitSections(text: string): Section[] {
  const lines = text.split("\n");
  const out: Section[] = [];
  let cur: Section = { body: "" };
  let bodyLines: string[] = [];

  function flush() {
    cur.body = bodyLines.join("\n").trim();
    if (cur.body || cur.heading) out.push(cur);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const startsWithIcon = HEADING_ICONS.find((i) => trimmed.startsWith(i));
    if (startsWithIcon) {
      // Push previous section
      flush();
      cur = {
        heading: {
          icon: startsWithIcon,
          label: trimmed.slice(startsWithIcon.length).trim(),
        },
        body: "",
      };
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }
  flush();
  return out;
}

function FallbackContent({
  why,
  hint,
  ai_leverage,
  escalation_hint,
}: {
  why: string;
  hint?: string;
  ai_leverage?: string;
  escalation_hint?: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed">{why}</p>
      {hint ? (
        <Block label="실행 힌트" body={hint} />
      ) : null}
      {ai_leverage ? (
        <Block label="AI로 가속하는 법" body={ai_leverage} />
      ) : null}
      {escalation_hint ? (
        <Block label="회사 목표와의 관계" body={escalation_hint} />
      ) : null}
      <p className="label-mono pt-2 border-t border-ink-soft/30 italic">
        ⓘ 자세한 용어 풀이는 곧 추가될 예정입니다 — 현재는 위 정보로 실행
        가능합니다.
      </p>
    </div>
  );
}

function Block({ label, body }: { label: string; body: ReactNode }) {
  return (
    <div>
      <p className="kicker !text-ink mb-1">{label}</p>
      <p className="text-[13px] leading-relaxed">{body}</p>
    </div>
  );
}

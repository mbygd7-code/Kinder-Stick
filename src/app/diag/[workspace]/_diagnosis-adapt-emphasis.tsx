"use client";

/**
 * Diagnosis form domain emphasis applier.
 *
 * AdaptationOutput 의 강조 도메인을 진단 폼의 `<section data-domain="...">` 에
 * 시각적으로 적용:
 *   - 좌측 컬러 보더 (high=red, medium=amber)
 *   - section 헤더 우측에 "★ 우선 점검" / "● 권장" 배지
 *
 * 워크리스트의 AdaptEmphasisApplier 와 같은 패턴 — DOM 직접 조작 (read-only
 * enhance), React rerender 무관.
 */

import { useEffect } from "react";
import {
  computeOpsContextAdaptation,
  loadOpsContextFromLocalStorage,
} from "@/lib/ops-context/adapt";

interface Props {
  workspace: string;
}

const BADGE_ID_PREFIX = "diag-adapt-badge-";

export function DiagnosisAdaptEmphasisApplier({ workspace }: Props) {
  useEffect(() => {
    async function apply() {
      // 서버 우선
      let ctx = null;
      try {
        const res = await fetch(
          `/api/ops-context/${encodeURIComponent(workspace)}`,
        );
        if (res.ok) {
          const d = await res.json();
          if (d.ok && d.data && Object.keys(d.data).length > 0) {
            ctx = d.data;
          }
        }
      } catch {}
      if (!ctx) ctx = loadOpsContextFromLocalStorage(workspace);
      const adapt = computeOpsContextAdaptation(ctx);
      const sevByDomain = new Map(
        adapt.emphasized.map((d) => [d.domain, d.severity]),
      );

      const sections = document.querySelectorAll<HTMLElement>(
        "[data-domain]",
      );
      sections.forEach((sec) => {
        const code = sec.dataset.domain;
        if (!code) return;
        const sev = sevByDomain.get(code);

        // 1) 좌측 컬러 보더
        if (sev === "high") {
          sec.style.borderLeftWidth = "4px";
          sec.style.borderLeftColor = "var(--signal-red, #b8001f)";
          sec.style.paddingLeft = "1.25rem";
          sec.dataset.adaptEmphasis = "high";
        } else if (sev === "medium") {
          sec.style.borderLeftWidth = "4px";
          sec.style.borderLeftColor = "var(--signal-amber, #d68b00)";
          sec.style.paddingLeft = "1.25rem";
          sec.dataset.adaptEmphasis = "medium";
        } else {
          sec.style.borderLeftWidth = "";
          sec.style.borderLeftColor = "";
          sec.style.paddingLeft = "";
          delete sec.dataset.adaptEmphasis;
        }

        // 2) "우선 점검" 배지 — 헤더 우측에 추가
        const header = sec.querySelector<HTMLElement>("header");
        const existingBadge = sec.querySelector<HTMLElement>(
          `[id^='${BADGE_ID_PREFIX}']`,
        );
        if (sev && header) {
          if (existingBadge) {
            existingBadge.textContent =
              sev === "high" ? "★ 우선 점검" : "● 점검 권장";
            existingBadge.style.color =
              sev === "high"
                ? "var(--signal-red, #b8001f)"
                : "var(--signal-amber, #d68b00)";
            existingBadge.style.borderColor =
              sev === "high"
                ? "var(--signal-red, #b8001f)"
                : "var(--signal-amber, #d68b00)";
          } else {
            const badge = document.createElement("span");
            badge.id = `${BADGE_ID_PREFIX}${code}`;
            badge.className =
              "label-mono px-2 py-0.5 border whitespace-nowrap shrink-0";
            badge.textContent =
              sev === "high" ? "★ 우선 점검" : "● 점검 권장";
            badge.style.color =
              sev === "high"
                ? "var(--signal-red, #b8001f)"
                : "var(--signal-amber, #d68b00)";
            badge.style.borderColor =
              sev === "high"
                ? "var(--signal-red, #b8001f)"
                : "var(--signal-amber, #d68b00)";
            // 헤더 right-side div 에 배지 추가, 없으면 header 끝에 append
            const rightDiv = header.querySelector<HTMLElement>(
              "div:last-child",
            );
            if (rightDiv) {
              rightDiv.insertBefore(badge, rightDiv.firstChild);
            } else {
              header.appendChild(badge);
            }
          }
        } else if (existingBadge) {
          existingBadge.remove();
        }
      });
    }

    apply();
    const onChange = () => apply();
    window.addEventListener("storage", onChange);
    window.addEventListener("ops-context:applied", onChange);
    // domain section 들은 동적 렌더 — interval safety net
    const interval = window.setInterval(apply, 5000);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("ops-context:applied", onChange);
      window.clearInterval(interval);
      // cleanup badges/styles
      document
        .querySelectorAll<HTMLElement>("[data-domain]")
        .forEach((sec) => {
          sec.style.borderLeftWidth = "";
          sec.style.borderLeftColor = "";
          sec.style.paddingLeft = "";
          delete sec.dataset.adaptEmphasis;
          sec.querySelectorAll(`[id^='${BADGE_ID_PREFIX}']`).forEach((b) =>
            b.remove(),
          );
        });
    };
  }, [workspace]);

  return null;
}

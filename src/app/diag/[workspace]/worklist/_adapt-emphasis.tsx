"use client";

/**
 * Worklist task emphasis applier.
 *
 * OpsContext adaptation 결과를 읽어 `[data-boost-domains]` 가 강조 domain 과
 * 교집합이 있는 task `<li>` 에 `data-adapt-emphasis="high|medium"` 속성을
 * 부여. CSS 가 그 속성을 보고 좌측 두꺼운 컬러 보더 + 배경을 입힘.
 *
 * 사이드 이펙트:
 *   - DOM 직접 setAttribute — 다른 React rerender 와 무관 (read-only enhance)
 *   - OpsContext 변경 시 storage 이벤트 + 2초 폴링으로 갱신
 */

import { useEffect } from "react";
import {
  computeOpsContextAdaptation,
  loadOpsContextFromLocalStorage,
} from "@/lib/ops-context/adapt";

interface Props {
  workspace: string;
}

export function AdaptEmphasisApplier({ workspace }: Props) {
  useEffect(() => {
    async function apply() {
      // 서버 우선, 실패 시 localStorage
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

      const tasks = document.querySelectorAll<HTMLElement>(
        "[data-boost-domains]",
      );
      tasks.forEach((el) => {
        const domains = (el.dataset.boostDomains ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        let topSev: "high" | "medium" | null = null;
        for (const d of domains) {
          const sev = sevByDomain.get(d);
          if (sev === "high") {
            topSev = "high";
            break; // highest, stop
          }
          if (sev === "medium" && topSev === null) {
            topSev = "medium";
          }
        }
        if (topSev) {
          el.dataset.adaptEmphasis = topSev;
          // Tailwind data-attr classes 의존성 보조: inline border 직접 적용
          el.style.borderLeftWidth = "4px";
          el.style.borderLeftColor =
            topSev === "high"
              ? "var(--signal-red, #b8001f)"
              : "var(--signal-amber, #d68b00)";
        } else {
          if (el.dataset.adaptEmphasis) delete el.dataset.adaptEmphasis;
          el.style.borderLeftWidth = "";
          el.style.borderLeftColor = "";
        }
      });
    }

    apply();
    const onChange = () => apply();
    window.addEventListener("storage", onChange);
    window.addEventListener("ops-context:applied", onChange);
    // search filter 가 DOM 갱신할 때 강조도 같이 다시 — interval 로 안전망
    const interval = window.setInterval(apply, 5000);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("ops-context:applied", onChange);
      window.clearInterval(interval);
    };
  }, [workspace]);

  return null;
}

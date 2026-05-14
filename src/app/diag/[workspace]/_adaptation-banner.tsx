"use client";

/**
 * Adaptation Banner — 회사 컨디션(OpsContext) 분석 결과를 진단 폼·워크리스트
 * 상단에 노출. 어느 도메인을 우선 점검해야 하는지 직관적으로 보여줌.
 *
 * 위치:
 *   - 진단 페이지 (_unified-shell.tsx) — OpsContext 입력 후·진단 폼 위
 *   - 워크리스트 (worklist/page.tsx) — 상단 hero 아래
 */

import { useEffect, useState } from "react";
import type { AdaptationOutput } from "@/lib/ops-context/adapt";
import {
  computeOpsContextAdaptation,
  loadOpsContextFromLocalStorage,
} from "@/lib/ops-context/adapt";

interface Props {
  workspace: string;
  /** "진단" | "워크리스트" — 라벨용 */
  context?: "diagnosis" | "worklist";
}

export function AdaptationBanner({ workspace, context = "diagnosis" }: Props) {
  const [adapt, setAdapt] = useState<AdaptationOutput | null>(null);

  useEffect(() => {
    async function reload() {
      // 서버 우선, 실패 시 localStorage
      try {
        const res = await fetch(
          `/api/ops-context/${encodeURIComponent(workspace)}`,
        );
        if (res.ok) {
          const d = await res.json();
          if (d.ok && d.data && Object.keys(d.data).length > 0) {
            setAdapt(computeOpsContextAdaptation(d.data));
            return;
          }
        }
      } catch {}
      const ctx = loadOpsContextFromLocalStorage(workspace);
      setAdapt(computeOpsContextAdaptation(ctx));
    }
    reload();
    window.addEventListener("storage", reload);
    const onApplied = () => reload();
    window.addEventListener("ops-context:applied", onApplied);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("ops-context:applied", onApplied);
    };
  }, [workspace]);

  if (!adapt) return null;

  const realism = adapt.realism_warnings;

  // 도메인 강조 카드 제거됨 (2026-05-16) — 동일 정보가 진단 폼 sub-item section
  // 의 좌측 컬러 보더 + "★ 우선 점검" 배지 (DiagnosisAdaptEmphasisApplier)
  // 및 워크리스트 task 좌측 보더 (AdaptEmphasisApplier) 로 이미 노출되므로
  // 중복 제거. 단, 진단 신뢰도와 직결되는 현실성 경고는 유지.

  if (realism.length === 0) return null;

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8 space-y-4">
      {/* 목표 격차 정보 — value judgment X, raw ratio 만 */}
      {realism.length > 0 ? (
        <div className="border-2 border-ink-soft/40 bg-paper p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
            <p className="kicker">목표 격차 정보</p>
            <span className="label-mono">{realism.length}건 · raw ratio</span>
          </div>
          <p className="text-sm leading-relaxed mb-3 text-ink-soft">
            단순 산술 격차입니다. <strong>"비현실적" 같은 판단은 하지 않음</strong>{" "}
            — 출시일·런웨이·팀·경쟁 변수까지 고려한 분석은 아래 "AI 심화
            분석" 으로 확인하세요.
          </p>
          <ul className="space-y-2">
            {realism.map((w, i) => {
              const dotColor =
                w.severity === "very_large"
                  ? "bg-signal-red/60"
                  : w.severity === "significant"
                    ? "bg-signal-amber/60"
                    : "bg-cobalt/50";
              return (
                <li
                  key={i}
                  className="border-l-4 border-ink-soft/40 pl-3 py-1.5 bg-paper-soft flex items-baseline gap-2 flex-wrap"
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${dotColor} shrink-0 self-center`}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-sm text-ink">{w.metric}</span>
                  <span className="label-mono opacity-50">·</span>
                  <span className="label-mono">
                    {w.current.toLocaleString("ko-KR")} →{" "}
                    {w.goal.toLocaleString("ko-KR")}
                  </span>
                  <span className="label-mono opacity-50">·</span>
                  <span className="label-mono font-bold">
                    {w.ratio.toFixed(1)}배
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}


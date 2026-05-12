"use client";

import { useEffect, useState } from "react";
import {
  TASKS,
  type Status,
  STATUS_LABEL,
  getBoostDomains,
  getBoostPoints,
} from "@/lib/worklist/catalog";

/**
 * WorklistImpactBanner — 진단 결과 페이지에 워크리스트 진행을 반영한 점수를 표시.
 *
 * 사용자가 워크리스트에서 task 를 완료할 때마다 result page 의 점수가 자동으로
 * 갱신되어 노력의 효과가 즉시 가시화된다.
 *
 * 동작:
 *  1. localStorage 에서 모든 task 의 status 읽음 (`worklist:{ws}:{taskId}`)
 *  2. status = "done" 인 task 의 boost_domains 별 boost_points 누적
 *  3. 도메인별 점수 변동 + 전체 점수 변동을 그래픽으로 표시
 *  4. "워크리스트 반영" / "원본 진단만" 토글
 */

interface DomainScore {
  code: string;
  score: number | null;
}

interface Props {
  workspace: string;
  /** 분기 진단 시점의 도메인 점수 (서버에서 계산된 baseline) */
  baseline: DomainScore[];
  /** 분기 진단 시점의 overall 점수 */
  baselineOverall: number | null;
}

export function WorklistImpactBanner({
  workspace,
  baseline,
  baselineOverall,
}: Props) {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const refresh = () => {
      if (typeof window === "undefined") return;
      const map: Record<string, Status> = {};
      for (const t of TASKS) {
        try {
          const raw = window.localStorage.getItem(
            `worklist:${workspace}:${t.id}`,
          );
          if (!raw) continue;
          const parsed = JSON.parse(raw) as { status: Status };
          if (parsed.status) map[t.id] = parsed.status;
        } catch {
          // ignore
        }
      }
      setStatuses(map);
    };
    refresh();
    window.addEventListener("worklist:change", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("worklist:change", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [workspace]);

  if (!mounted) return null;

  // 진행 중·완료 task의 boost 계산
  // - done    : 100% boost
  // - in_progress : 50% boost
  // - scheduled : 10% boost
  // - not_started : 0%
  const factorFor = (s: Status | undefined): number => {
    if (s === "done") return 1.0;
    if (s === "in_progress") return 0.5;
    if (s === "scheduled") return 0.1;
    return 0;
  };

  const boostsByDomain: Record<string, number> = {};
  let doneCount = 0;
  let totalCount = 0;
  for (const t of TASKS) {
    totalCount += 1;
    const s = statuses[t.id] ?? "not_started";
    const f = factorFor(s);
    if (s === "done") doneCount += 1;
    if (f === 0) continue;
    const pts = getBoostPoints(t) * f;
    const domains = getBoostDomains(t);
    for (const d of domains) {
      boostsByDomain[d] = (boostsByDomain[d] ?? 0) + pts;
    }
  }

  const adjusted: DomainScore[] = baseline.map((d) => ({
    code: d.code,
    score:
      d.score === null
        ? null
        : Math.max(0, Math.min(100, d.score + (boostsByDomain[d.code] ?? 0))),
  }));

  // overall 단순 평균 (가중 평균 정확치는 아니지만 trend 직관 표시용)
  const totalAdjustedDelta = baseline.reduce((sum, d, i) => {
    if (d.score === null || adjusted[i].score === null) return sum;
    return sum + (adjusted[i].score! - d.score);
  }, 0);
  const validCount = baseline.filter((d) => d.score !== null).length;
  const overallDelta =
    validCount > 0 && baselineOverall !== null
      ? totalAdjustedDelta / validCount
      : 0;
  const adjustedOverall =
    baselineOverall !== null
      ? Math.max(0, Math.min(100, baselineOverall + overallDelta))
      : null;

  const hasAnyProgress = Object.keys(boostsByDomain).length > 0;

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-6">
      <div className="border-2 border-ink bg-paper-soft p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="t-label-accent">워크리스트 반영 점수</p>
            <h2 className="t-display-3 text-ink mt-1">
              지금까지 한 일이 점수에 반영된 결과
            </h2>
            <p className="t-meta mt-1">
              완료한 업무가 진단 도메인 점수에 즉시 가산됩니다 (현재{" "}
              <strong className="font-semibold text-ink">{doneCount}</strong> /{" "}
              {totalCount} 완료).
            </p>
          </div>
          {!hasAnyProgress ? (
            <p className="t-meta italic">
              아직 진행된 업무가 없습니다 — 워크리스트에서 업무를 시작해보세요.
            </p>
          ) : null}
        </div>

        {/* Overall comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <div className="border-2 border-ink-soft/40 bg-paper px-4 py-3">
            <p className="t-label mb-1">분기 진단 (baseline)</p>
            <p className="t-display-2 text-ink t-num">
              {baselineOverall !== null ? baselineOverall.toFixed(1) : "—"}
            </p>
          </div>
          <div className="border-2 border-accent bg-paper px-4 py-3">
            <p className="t-label-accent mb-1">워크리스트 반영 후</p>
            <p className="t-display-2 text-accent t-num">
              {adjustedOverall !== null ? adjustedOverall.toFixed(1) : "—"}
            </p>
          </div>
          <div className="border-2 border-ink-soft/40 bg-paper px-4 py-3">
            <p className="t-label mb-1">변동</p>
            <p
              className={`t-display-2 t-num ${
                overallDelta >= 0 ? "text-green" : "text-accent"
              }`}
            >
              {overallDelta >= 0 ? "+" : ""}
              {overallDelta.toFixed(1)}
              <span className="t-meta">pt</span>
            </p>
          </div>
        </div>

        {/* Per-domain breakdown */}
        {hasAnyProgress ? (
          <details className="border-t border-ink-soft/30 pt-3">
            <summary className="cursor-pointer t-label hover:text-ink">
              도메인별 상세 (총 {Object.keys(boostsByDomain).length}개 변동)
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {baseline.map((d, i) => {
                const boost = boostsByDomain[d.code] ?? 0;
                if (boost === 0) return null;
                const before = d.score ?? 0;
                const after = adjusted[i].score ?? 0;
                return (
                  <div
                    key={d.code}
                    className="border border-ink-soft/40 bg-paper px-3 py-2 flex items-baseline justify-between gap-2"
                  >
                    <span className="t-body-sm font-semibold">{d.code}</span>
                    <span className="t-meta t-num">
                      {before.toFixed(1)} →{" "}
                      <strong className="text-green">{after.toFixed(1)}</strong>
                      <span className="ml-1 text-ink-soft">
                        (+{boost.toFixed(1)})
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="t-meta mt-3">
              상태별 가중치: 완료 100%, 진행 중 50%, 예정 10%, 안 함 0%.{" "}
              <span className="text-ink-soft">
                ({STATUS_LABEL.done}/{STATUS_LABEL.in_progress}/
                {STATUS_LABEL.scheduled})
              </span>
            </p>
          </details>
        ) : null}
      </div>
    </section>
  );
}

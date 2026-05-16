"use client";

import { useEffect, useState } from "react";
import {
  TASKS,
  type Status,
  STATUS_LABEL,
  getBoostDomains,
  getBoostPoints,
} from "@/lib/worklist/catalog";
import { readKpiProgress } from "../worklist/_task-kpi-checklist";

/**
 * WorklistImpactBanner — 진단 결과 페이지에 워크리스트 KPI 충족을 반영한 점수.
 *
 * 3-tier 모델 Phase 5:
 *  - 이전: task status (done/in_progress/scheduled) 체크박스만으로 부스트
 *  - 현재: KPI 충족 비율(%) 을 부스트 계수로 사용 → 실측 신뢰
 *
 * 동작:
 *  1. localStorage 의 모든 task KPI 체크 비율 읽음
 *  2. percent/100 × boost_points 를 boost_domains 에 누적
 *  3. KPI 가 정의되지 않은 task 는 영향 없음 (체크박스만으로는 점수 변동 X)
 *  4. 도메인별 점수 변동 + 전체 점수 변동 그래픽 표시
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
  const [kpiFactors, setKpiFactors] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const refresh = () => {
      if (typeof window === "undefined") return;
      const kpiMap: Record<string, number> = {};
      const statusMap: Record<string, Status> = {};
      for (const t of TASKS) {
        // KPI 충족 비율 (0~1)
        const prog = readKpiProgress(workspace, t);
        if (prog && prog.total > 0) {
          kpiMap[t.id] = prog.checked / prog.total;
        }
        // status 는 카운터 표시용으로만 유지
        try {
          const raw = window.localStorage.getItem(
            `worklist:${workspace}:${t.id}`,
          );
          if (raw) {
            const parsed = JSON.parse(raw) as { status: Status };
            if (parsed.status) statusMap[t.id] = parsed.status;
          }
        } catch {
          // ignore
        }
      }
      setKpiFactors(kpiMap);
      setStatuses(statusMap);
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

  // Phase 5: KPI 충족 비율 (0~1) 이 부스트 계수.
  // 체크박스 status 는 더 이상 점수에 영향 X — 표시 카운터로만 유지.
  const boostsByDomain: Record<string, number> = {};
  let doneCount = 0;
  let totalCount = 0;
  let kpiVerifiedCount = 0;
  for (const t of TASKS) {
    totalCount += 1;
    const s = statuses[t.id] ?? "not_started";
    if (s === "done") doneCount += 1;
    const factor = kpiFactors[t.id] ?? 0;
    if (factor > 0) {
      if (factor === 1) kpiVerifiedCount += 1;
      const pts = getBoostPoints(t) * factor;
      const domains = getBoostDomains(t);
      for (const d of domains) {
        boostsByDomain[d] = (boostsByDomain[d] ?? 0) + pts;
      }
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
              <strong className="font-semibold text-ink">KPI 충족</strong>이
              점수에 반영됩니다 (KPI 모두 충족{" "}
              <strong className="font-semibold text-ink">
                {kpiVerifiedCount}
              </strong>{" "}
              · 일부 충족{" "}
              <strong className="font-semibold text-ink">
                {
                  Object.values(kpiFactors).filter(
                    (f) => f > 0 && f < 1,
                  ).length
                }
              </strong>{" "}
              · 업무 완료 카운트 {doneCount}/{totalCount}).
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

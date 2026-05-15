"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeImpact,
  readTaskStatuses,
  type DiagnosisBaseline,
} from "@/lib/worklist/impact";
import { getStageLabel } from "@/lib/stage-labels";

interface Props {
  workspace: string;
  /** server 에서 aggregateRespondents 로 만든 baseline. null 이면 진단 없음. */
  baseline: DiagnosisBaseline | null;
  /** 워크스페이스·메타 정보 — hero 좌상단에 노출 */
  workspaceMeta?: {
    totalTasks: number;
    teamsLabel?: string; // "6팀 · 4단계" 같은 라벨
  };
}


/**
 * 실시간 실패확률 변화 — 페이지 상단 HERO.
 *
 * 워크리스트 task 상태가 바뀔 때마다 자동 재계산하여
 * "진단 직후 → 현재 진행 반영 → 100% 완료 시 잠재" 실패확률을
 * 편집디자인(매거진) 풍으로 보여준다.
 *
 * 박스 없이 두꺼운 룰 + 큰 디스플레이 타이포그래피 + 비대칭 그리드로 구성.
 */
export function ImpactPanel({ workspace, baseline, workspaceMeta }: Props) {
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("worklist:change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("worklist:change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const taskStatuses = useMemo(() => {
    void tick; // re-read on tick
    return readTaskStatuses(workspace);
  }, [workspace, tick]);

  // ── No-diagnosis fallback — slim hero with prompt to start diagnosis
  if (!baseline) {
    return (
      <section className="border-b border-ink-soft/40">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-10 pb-10">
          <div className="flex items-baseline gap-3 mb-4 flex-wrap">
            <span className="kicker">
              <span className="section-num">No. </span>01
            </span>
            <span className="label-mono opacity-50">·</span>
            <span className="kicker !text-ink-soft">실시간 실패확률</span>
          </div>
          <h1 className="font-display text-3xl sm:text-5xl leading-[1.05] tracking-tight break-keep mb-4">
            진단을 끝내면 여기에{" "}
            <span className="italic font-light text-accent">실시간 변화</span>가
            보입니다.
          </h1>
          <p className="text-base sm:text-lg leading-relaxed text-ink-soft max-w-3xl">
            진단 응답을 제출하면 '진단 직후 → 워크리스트 완료 → 100% 잠재
            시점'의 6개월 실패확률이 이 자리에 펼쳐집니다. 업무를 하나씩
            '완료'로 바꿀 때마다 숫자가 줄어드는 걸 직접 보면서 일할 수
            있습니다.
          </p>
          <a
            href={`/diag/${workspace}`}
            className="btn-primary mt-6 inline-flex"
          >
            진단 시작 <span className="font-mono text-xs">→</span>
          </a>
        </div>
      </section>
    );
  }

  const impact = computeImpact({
    baseline,
    taskStatuses: mounted ? taskStatuses : {},
  });

  const fmt = (v: number) => `${Math.round(v * 100)}`;
  const dropNow6 = impact.baselineFp6m - impact.adjustedFp6m;
  const dropPotential6 =
    impact.baselineFp6m - impact.potentialFp6mIfAllDone;
  const dropNowPct = Math.round(dropNow6 * 100);
  const dropPotentialPct = Math.round(dropPotential6 * 100);
  const totalPct = Math.round(impact.totalCompletionRatio * 100);
  const mustPct = Math.round(impact.mustCompletionRatio * 100);

  // 톤 계산 (현재 시점 기준)
  const adjustedTone =
    impact.adjustedFp6m < 0.25
      ? "green"
      : impact.adjustedFp6m < 0.45
        ? "amber"
        : "red";

  // 여정 진행도 — baseline 부터 potential 까지의 거리에서 현재가 어디인지
  const journeyPct =
    impact.baselineFp6m === impact.potentialFp6mIfAllDone
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            ((impact.baselineFp6m - impact.adjustedFp6m) /
              (impact.baselineFp6m - impact.potentialFp6mIfAllDone)) *
              100,
          ),
        );

  const stageLabel = getStageLabel(baseline.stage);

  return (
    <section className="border-b border-ink-soft/40">
      <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-10 pb-12 sm:pb-14">
        {/* 헤더 라인 — 챕터 번호 + 라벨 + 메타 */}
        <div className="flex items-baseline justify-between flex-wrap gap-3 mb-6">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="kicker">
              <span className="section-num">No. </span>01
            </span>
            <span className="label-mono opacity-50">·</span>
            <span className="kicker !text-ink-soft">실시간 실패확률</span>
          </div>
          <span className="label-mono">
            {stageLabel} · 응답자 {baseline.respondentCount}명
            {workspaceMeta
              ? ` · ${workspaceMeta.totalTasks}개 업무${workspaceMeta.teamsLabel ? " · " + workspaceMeta.teamsLabel : ""}`
              : ""}
          </span>
        </div>

        {/* 큰 헤드라인 — italic 강조 */}
        <h1 className="font-display text-3xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight break-keep">
          업무를 완료할수록,{" "}
          <span className="italic font-light">실패확률은 줄어듭니다.</span>
        </h1>

        {/* Editorial split — 7/5 비대칭. 박스 없음, 가운데 vertical rule. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 mt-10">
          {/* 좌 7/12: 현재 6개월 실패확률 — 가장 큰 숫자 */}
          <div className="lg:col-span-7">
            <p className="kicker mb-3">현재 진행 반영 · 6개월 실패확률</p>
            <p className="font-display leading-[0.9] tracking-tight">
              <span
                className={`text-8xl sm:text-[9rem] ${
                  adjustedTone === "red"
                    ? "text-signal-red"
                    : adjustedTone === "amber"
                      ? "text-signal-amber"
                      : "text-signal-green"
                }`}
              >
                {fmt(impact.adjustedFp6m)}
              </span>
              <span className="text-3xl text-ink-soft font-light tracking-wider">
                {" "}
                %
              </span>
            </p>
            <p className="mt-5 text-base sm:text-lg leading-relaxed text-ink-soft max-w-xl">
              {dropNowPct === 0
                ? `업무를 '완료'로 바꿀 때마다 도메인 점수가 올라가고 이 숫자가 줄어듭니다. 모두 완료 시 잠재 최저는 ${fmt(
                    impact.potentialFp6mIfAllDone,
                  )}% (현재 대비 ${dropPotentialPct}%p 감소).`
                : dropNowPct < 5
                  ? `좋은 시작 — 이미 ${dropNowPct}%p 낮아졌습니다. 다음 필수 업무를 완료하세요. 잠재 최저는 ${fmt(
                      impact.potentialFp6mIfAllDone,
                    )}%.`
                  : dropNowPct < 15
                    ? `실행이 효과를 만들고 있습니다 — 진단 대비 ${dropNowPct}%p 감소. 필수 업무를 더 끝낼수록 효과는 누적됩니다.`
                    : `훌륭합니다 — 진단 대비 ${dropNowPct}%p 감소. 100% 완료 시 ${dropPotentialPct}%p까지 가능합니다.`}
            </p>
          </div>

          {/* 우 5/12: 진단 / 잠재 stacked. vertical rule 로 구분. */}
          <div className="lg:col-span-5 lg:border-l lg:border-ink-soft/40 lg:pl-12 border-t pt-8 lg:pt-0 lg:border-t-0">
            <div className="space-y-6">
              <div>
                <p className="kicker mb-2">진단 직후</p>
                <p
                  className={`font-display text-5xl leading-none tracking-tight ${
                    impact.baselineFp6m >= 0.45
                      ? "text-signal-red"
                      : impact.baselineFp6m >= 0.25
                        ? "text-signal-amber"
                        : "text-signal-green"
                  }`}
                >
                  {fmt(impact.baselineFp6m)}
                  <span className="text-xl text-ink-soft font-light">%</span>
                </p>
                <p className="mt-1 label-mono">
                  아무것도 안 하면 6개월 안에 회사가 심각한 어려움을 겪을 가능성
                </p>
              </div>

              <div className="dotted-rule" />

              <div>
                <p className="kicker mb-2">모두 완료 시 잠재</p>
                <p
                  className={`font-display text-5xl leading-none tracking-tight ${
                    impact.potentialFp6mIfAllDone >= 0.45
                      ? "text-signal-red"
                      : impact.potentialFp6mIfAllDone >= 0.25
                        ? "text-signal-amber"
                        : "text-signal-green"
                  }`}
                >
                  {fmt(impact.potentialFp6mIfAllDone)}
                  <span className="text-xl text-ink-soft font-light">%</span>
                </p>
                <p className="mt-1 label-mono">
                  필수 업무를 모두 끝냈을 때의 이론적 최저 위험 ({dropPotentialPct}%p 감소 가능)
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 여정 바 — 박스 없이 가로 막대 + 라벨 */}
        <div className="mt-12">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
            <p className="kicker">여정</p>
            <p className="label-mono">
              필수 진행 {mustPct}% · 전체 진행 {totalPct}%
            </p>
          </div>
          <div
            className="h-2 bg-paper-deep relative overflow-hidden"
            aria-label="실패확률 여정 진행도"
          >
            {/* baseline marker (right) */}
            <div
              className="absolute top-0 bottom-0 w-px bg-ink-soft"
              style={{ right: 0 }}
              title={`진단: ${fmt(impact.baselineFp6m)}%`}
            />
            {/* potential marker (left) */}
            <div
              className="absolute top-0 bottom-0 w-px bg-ink-soft"
              style={{ left: 0 }}
              title={`잠재: ${fmt(impact.potentialFp6mIfAllDone)}%`}
            />
            {/* progress fill */}
            <div
              className={`h-full transition-all duration-500 ${
                adjustedTone === "red"
                  ? "bg-signal-red"
                  : adjustedTone === "amber"
                    ? "bg-signal-amber"
                    : "bg-signal-green"
              }`}
              style={{ width: `${journeyPct}%` }}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between label-mono">
            <span>
              ← 잠재 <span className="font-mono">{fmt(impact.potentialFp6mIfAllDone)}%</span>
            </span>
            <span>
              현재 <span className="font-mono">{fmt(impact.adjustedFp6m)}%</span>
            </span>
            <span>
              진단 <span className="font-mono">{fmt(impact.baselineFp6m)}%</span> →
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

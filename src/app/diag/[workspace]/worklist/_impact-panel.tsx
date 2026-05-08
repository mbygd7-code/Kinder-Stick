"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeImpact,
  readTaskStatuses,
  type DomainBaseline,
} from "@/lib/worklist/impact";

interface Props {
  workspace: string;
  baselines: DomainBaseline[];
  prior_fp_6m: number;
  prior_fp_12m: number;
  hasDiagnosis: boolean;
}

/**
 * Live impact panel — 워크리스트 task 상태가 바뀔 때마다 자동 재계산하여
 * “현재 vs 워크리스트 완료 후 예상 vs 100% 완료 시 잠재” 실패확률을 보여준다.
 */
export function ImpactPanel({
  workspace,
  baselines,
  prior_fp_6m,
  prior_fp_12m,
  hasDiagnosis,
}: Props) {
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

  if (!hasDiagnosis) {
    return (
      <section className="border-2 border-ink bg-paper-soft p-5 sm:p-6">
        <p className="kicker mb-1">실시간 실패확률 변화</p>
        <h2 className="font-display text-2xl leading-tight">
          진단을 한 번 끝내면 여기 실시간 변화가 보입니다
        </h2>
        <p className="mt-2 label-mono leading-relaxed">
          진단 응답을 제출하면 ‘지금 우리 위치 → 워크리스트 완료 시 예상 위치’가
          이 자리에 실시간으로 표시됩니다. 업무를 ‘완료’로 바꿀 때마다 실패확률
          숫자가 줄어드는 걸 직접 보면서 일할 수 있습니다.
        </p>
      </section>
    );
  }

  const impact = computeImpact({
    baselines,
    prior_fp_6m,
    prior_fp_12m,
    taskStatuses: mounted ? taskStatuses : {},
  });

  const fmt = (v: number) => `${Math.round(v * 100)}%`;
  const dropNow6 = impact.baselineFp6m - impact.adjustedFp6m;
  const dropPotential6 =
    impact.baselineFp6m - impact.potentialFp6mIfAllDone;
  const dropNowPct = Math.round(dropNow6 * 100);
  const totalPct = Math.round(impact.totalCompletionRatio * 100);
  const mustPct = Math.round(impact.mustCompletionRatio * 100);

  return (
    <section className="border-2 border-ink bg-paper-soft p-5 sm:p-6">
      <header className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="kicker mb-1">실시간 실패확률 변화</p>
          <h2 className="font-display text-xl sm:text-2xl leading-tight break-keep">
            업무를 완료할수록 실패확률이 줄어듭니다
          </h2>
        </div>
        <p className="label-mono">
          필수 {mustPct}% · 전체 {totalPct}%
        </p>
      </header>

      {/* 3 stages of fp */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <FpCard
          label="진단 직후 (지금 그대로)"
          value={fmt(impact.baselineFp6m)}
          caption="아무것도 안 하면 6개월 안에"
          tone={
            impact.baselineFp6m < 0.25
              ? "green"
              : impact.baselineFp6m < 0.45
                ? "amber"
                : "red"
          }
          dim
        />
        <FpCard
          label="현재 진행 반영 → 6개월"
          value={fmt(impact.adjustedFp6m)}
          caption={
            dropNowPct > 0
              ? `진단 대비 ${dropNowPct}%p 낮아짐`
              : "아직 변화 없음 — 업무를 완료해보세요"
          }
          tone={
            impact.adjustedFp6m < 0.25
              ? "green"
              : impact.adjustedFp6m < 0.45
                ? "amber"
                : "red"
          }
        />
        <FpCard
          label="모두 완료 시 잠재"
          value={fmt(impact.potentialFp6mIfAllDone)}
          caption={`이론적 최저 (${Math.round(dropPotential6 * 100)}%p 감소)`}
          tone={
            impact.potentialFp6mIfAllDone < 0.25
              ? "green"
              : impact.potentialFp6mIfAllDone < 0.45
                ? "amber"
                : "red"
          }
          dim
        />
      </div>

      {/* journey bar — 진단 → 현재 → 잠재 */}
      <div className="mt-5">
        <p className="label-mono mb-1.5">
          여정: 진단{" "}
          <span className="font-mono">{fmt(impact.baselineFp6m)}</span> →
          현재 <span className="font-mono">{fmt(impact.adjustedFp6m)}</span>{" "}
          → 잠재{" "}
          <span className="font-mono">
            {fmt(impact.potentialFp6mIfAllDone)}
          </span>
        </p>
        <div
          className="h-2 bg-paper-deep border border-ink-soft/40 relative overflow-hidden"
          aria-label="실패확률 여정 진행도"
        >
          {/* baseline marker (right) */}
          <div
            className="absolute top-0 bottom-0 w-px bg-ink-soft"
            style={{ right: 0 }}
            title={`진단: ${fmt(impact.baselineFp6m)}`}
          />
          {/* potential marker (left) */}
          <div
            className="absolute top-0 bottom-0 w-px bg-ink-soft"
            style={{ left: 0 }}
            title={`잠재: ${fmt(impact.potentialFp6mIfAllDone)}`}
          />
          {/* progress fill */}
          <div
            className="h-full bg-green transition-all duration-500"
            style={{
              width: `${
                impact.baselineFp6m === impact.potentialFp6mIfAllDone
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        100,
                        ((impact.baselineFp6m - impact.adjustedFp6m) /
                          (impact.baselineFp6m -
                            impact.potentialFp6mIfAllDone)) *
                          100,
                      ),
                    )
              }%`,
            }}
          />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {dropNowPct === 0
            ? "업무를 ‘완료’로 표시할 때마다 도메인 점수가 올라가고, 위 여정에서 우리 위치가 잠재 쪽으로 이동합니다."
            : dropNowPct < 5
              ? `좋은 시작 — 이미 실패확률이 ${dropNowPct}%p 낮아졌습니다. 다음 필수 업무를 완료하세요.`
              : dropNowPct < 15
                ? `실행이 효과를 만들고 있습니다 — 진단 대비 ${dropNowPct}%p 감소. 필수 업무를 더 끝낼 때마다 효과는 누적됩니다.`
                : `훌륭합니다 — 실패확률이 ${dropNowPct}%p 떨어졌습니다. 100% 완료 시 ${Math.round(
                    dropPotential6 * 100,
                  )}%p까지 가능.`}
        </p>
      </div>
    </section>
  );
}

function FpCard({
  label,
  value,
  caption,
  tone,
  dim,
}: {
  label: string;
  value: string;
  caption: string;
  tone: "green" | "amber" | "red";
  dim?: boolean;
}) {
  const numColor =
    tone === "red"
      ? "text-signal-red"
      : tone === "amber"
        ? "text-signal-amber"
        : "text-signal-green";
  return (
    <div
      className={`bg-paper border ${
        dim ? "border-ink-soft/30" : "border-ink"
      } p-3 sm:p-4`}
    >
      <p className="label-mono mb-1">{label}</p>
      <p className={`font-display text-3xl sm:text-4xl leading-none ${numColor}`}>
        {value}
      </p>
      <p className="mt-1 label-mono leading-relaxed">{caption}</p>
    </div>
  );
}

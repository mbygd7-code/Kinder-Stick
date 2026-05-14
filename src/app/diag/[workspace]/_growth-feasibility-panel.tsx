"use client";

/**
 * Growth Feasibility Panel — OpsContext 기반 AI 가능성 분석.
 *
 * 위치: AdaptationBanner 아래 (또는 단독)
 * 동작:
 *   - "AI 심화 분석" 버튼 클릭 시에만 호출 (auto-run X — Claude 비용)
 *   - 로딩 후 시나리오·요인·caveats 노출
 *   - OpsContext 가 바뀌면 stale 표시 + 재분석 권장
 */

import { useState, useTransition, useEffect } from "react";

interface GrowthFeasibilityResult {
  feasibility_pct: number;
  summary: string;
  key_factors: Array<{
    name: string;
    value: string;
    impact: "positive" | "neutral" | "negative" | "blocker";
    note: string;
  }>;
  scenarios: Array<{
    label: string;
    probability_pct: number;
    required_actions: string[];
    reasoning: string;
  }>;
  caveats: string[];
}

interface AnalysisState {
  result: GrowthFeasibilityResult;
  evaluated_at: string;
  /** 분석 당시 OpsContext 의 revision 추적 — 변경되면 stale */
  ops_revision_at_analysis: number;
}

interface Props {
  workspace: string;
}

const IMPACT_TONE: Record<string, { color: string; label: string }> = {
  positive: { color: "!text-signal-green", label: "+ 긍정" },
  neutral: { color: "!text-cobalt", label: "○ 중립" },
  negative: { color: "!text-signal-amber", label: "− 부정" },
  blocker: { color: "!text-signal-red", label: "✕ 차단" },
};

const STORAGE_KEY = "kso-growth-feasibility-";

export function GrowthFeasibilityPanel({ workspace }: Props) {
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [currentRev, setCurrentRev] = useState<number>(0);
  const [analyzing, startAnalyzing] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // 캐시 로드
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}${workspace}`);
      if (raw) setAnalysis(JSON.parse(raw) as AnalysisState);
    } catch {}
  }, [workspace]);

  // 현재 OpsContext revision 추적 — stale 판정용
  useEffect(() => {
    let cancelled = false;
    async function loadRev() {
      try {
        const res = await fetch(
          `/api/ops-context/${encodeURIComponent(workspace)}`,
        );
        if (res.ok) {
          const d = await res.json();
          if (!cancelled && d.ok) {
            setCurrentRev(d.revision ?? 0);
          }
        }
      } catch {}
    }
    loadRev();
    const onApplied = () => loadRev();
    window.addEventListener("ops-context:applied", onApplied);
    return () => {
      cancelled = true;
      window.removeEventListener("ops-context:applied", onApplied);
    };
  }, [workspace]);

  function runAnalysis() {
    setErr(null);
    startAnalyzing(async () => {
      try {
        const res = await fetch(
          `/api/ops-context/${encodeURIComponent(workspace)}/growth-feasibility`,
          { method: "POST" },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setErr(data.message ?? "분석 실패");
          return;
        }
        const newState: AnalysisState = {
          result: data.result,
          evaluated_at: data.evaluated_at,
          ops_revision_at_analysis: currentRev,
        };
        setAnalysis(newState);
        try {
          localStorage.setItem(
            `${STORAGE_KEY}${workspace}`,
            JSON.stringify(newState),
          );
        } catch {}
      } catch (e) {
        setErr(String(e));
      }
    });
  }

  const isStale =
    analysis && currentRev > 0 && currentRev > analysis.ops_revision_at_analysis;

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8">
      <div className="border-2 border-ink bg-paper-soft p-5 sm:p-6">
        {/* Header */}
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="kicker mb-1">AI 다요인 분석</p>
            <h3 className="font-display text-xl sm:text-2xl leading-tight">
              목표 달성 가능성 — 시간·자본·인력·경쟁{" "}
              <span className="italic font-light">맥락 분석</span>
            </h3>
            <p className="mt-1 text-sm text-ink-soft leading-relaxed max-w-2xl">
              단순 ratio 비교가 아닌, 한국 영유아 EdTech 시장 패턴 + 출시
              시점·런웨이·팀·경쟁 압박을 모두 고려한 시나리오 분석입니다.
              Claude haiku 가 작성 — 절대값 X, 의사결정 보조용.
            </p>
          </div>
          <button
            type="button"
            onClick={runAnalysis}
            disabled={analyzing}
            className="btn-primary disabled:opacity-50 shrink-0 inline-flex items-center gap-2"
            aria-busy={analyzing}
          >
            {analyzing ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block w-3 h-3 border-2 border-paper border-t-transparent rounded-full animate-spin"
                />
                <span>분석 중…</span>
              </>
            ) : analysis ? (
              <span>{isStale ? "재분석 (입력 변경됨)" : "다시 분석"}</span>
            ) : (
              <>
                <span>AI 심화 분석</span>
                <span className="font-mono text-xs">→</span>
              </>
            )}
          </button>
        </div>

        {err ? (
          <p className="font-mono text-xs text-signal-red mb-3">⚠ {err}</p>
        ) : null}

        {!analysis && !analyzing ? (
          <p className="label-mono text-ink-soft leading-relaxed mt-4">
            ↳ 위 버튼을 누르면 회사 컨디션 + 영유아 EdTech 시장 맥락으로
            현재·보강 시나리오별 가능성을 분석합니다. 출시일·런웨이·팀
            규모·경쟁 압박을 04 섹션에 입력해두면 분석 정확도가 올라갑니다.
          </p>
        ) : null}

        {analysis ? (
          <AnalysisDisplay
            analysis={analysis}
            isStale={isStale ?? false}
          />
        ) : null}
      </div>
    </section>
  );
}

function AnalysisDisplay({
  analysis,
  isStale,
}: {
  analysis: AnalysisState;
  isStale: boolean;
}) {
  const { result, evaluated_at } = analysis;
  const pct = Math.max(0, Math.min(100, Math.round(result.feasibility_pct)));
  const tone =
    pct >= 60
      ? "text-signal-green"
      : pct >= 30
        ? "text-signal-amber"
        : "text-signal-red";

  return (
    <div className="mt-4 space-y-5">
      {isStale ? (
        <div className="border-l-4 border-signal-amber bg-soft-amber/30 pl-3 py-2">
          <p className="label-mono !text-signal-amber">
            ⚠ stale — OpsContext 가 분석 이후 변경되었습니다. 재분석 권장.
          </p>
        </div>
      ) : null}

      {/* 가능성 점수 */}
      <div className="flex items-baseline gap-5 flex-wrap pb-5 border-b border-ink-soft/30">
        <div>
          <p className="label-mono mb-1">현 상태 유지 시 달성 가능성</p>
          <p className={`font-display text-6xl leading-none ${tone}`}>
            {pct}
            <span className="font-mono text-2xl text-ink-soft ml-1">%</span>
          </p>
        </div>
        <div className="flex-1 min-w-[16rem]">
          <p className="text-sm leading-relaxed">{result.summary}</p>
          <p className="mt-2 label-mono text-ink-soft">
            분석 시각: {new Date(evaluated_at).toLocaleString("ko-KR")}
          </p>
        </div>
      </div>

      {/* 핵심 요인 */}
      <div>
        <p className="kicker mb-2">핵심 요인</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {result.key_factors.map((f, i) => {
            const t = IMPACT_TONE[f.impact] ?? IMPACT_TONE.neutral;
            return (
              <li
                key={i}
                className="border-l-4 pl-3 py-2 bg-paper border-ink-soft/40"
              >
                <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
                  <span className={`label-mono ${t.color}`}>{t.label}</span>
                  <span className="font-mono text-sm text-ink">{f.name}</span>
                  <span className="label-mono opacity-50">·</span>
                  <span className="label-mono">{f.value}</span>
                </div>
                <p className="label-mono text-ink-soft leading-relaxed">
                  {f.note}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 시나리오 */}
      <div>
        <p className="kicker mb-2">시나리오 — 어떻게 가능성을 높일 수 있나</p>
        <ol className="space-y-3">
          {result.scenarios.map((s, i) => {
            const p = Math.max(0, Math.min(100, Math.round(s.probability_pct)));
            const sTone =
              p >= 60
                ? "border-signal-green"
                : p >= 30
                  ? "border-signal-amber"
                  : "border-signal-red";
            return (
              <li
                key={i}
                className={`border-2 ${sTone} bg-paper p-4`}
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                  <h4 className="font-display text-base leading-tight">
                    <span className="text-ink-soft mr-2">
                      시나리오 {i + 1}
                    </span>
                    {s.label}
                  </h4>
                  <span
                    className={`font-display text-xl ${
                      p >= 60
                        ? "text-signal-green"
                        : p >= 30
                          ? "text-signal-amber"
                          : "text-signal-red"
                    }`}
                  >
                    {p}%
                  </span>
                </div>
                <p className="text-sm leading-relaxed mb-2">{s.reasoning}</p>
                {s.required_actions.length > 0 ? (
                  <div className="mt-2 pt-2 border-t border-ink-soft/30">
                    <p className="label-mono mb-1">필요 액션</p>
                    <ul className="space-y-1">
                      {s.required_actions.map((a, j) => (
                        <li
                          key={j}
                          className="text-sm leading-relaxed flex items-baseline gap-2"
                        >
                          <span className="font-mono text-xs text-accent">
                            {j + 1}.
                          </span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Caveats */}
      {result.caveats.length > 0 ? (
        <div className="pt-4 border-t border-ink-soft/30">
          <p className="kicker mb-2">한계·주의</p>
          <ul className="space-y-1">
            {result.caveats.map((c, i) => (
              <li key={i} className="label-mono text-ink-soft leading-relaxed">
                · {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

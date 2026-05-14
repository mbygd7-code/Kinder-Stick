"use client";

/**
 * Apply To Diagnosis Panel — OpsContext 입력 후 진단·워크리스트 반영의
 * 통합 진입점.
 *
 * 2-step flow:
 *   1. "진단에 반영" 버튼 클릭 → POST /api/ops-context/[ws]/growth-feasibility
 *      (draft ops 전송, DB commit X)
 *   2. AI 분석 결과 + 목표 격차 inline 표시
 *   3. "그대로 반영" → PUT /api/ops-context/[ws] (실제 commit + adapt 트리거)
 *      "다시 작성" → 분석만 재실행
 *
 * 이전엔 AdaptationBanner (목표 격차) + GrowthFeasibilityPanel (AI) 가
 * 별도 박스로 흩어져 있어 정보 fragmented. 통합으로 일관된 결정 흐름.
 */

import { useEffect, useState, useTransition } from "react";
import type { OpsContext } from "./_ops-context-section";

export interface RecommendedGoals {
  goal_new_signups_monthly?: number | null;
  goal_paid_users_monthly?: number | null;
  goal_plc_monthly?: number | null;
  goal_total_members_annual?: number | null;
  goal_paid_subscribers_annual?: number | null;
  goal_plc_annual?: number | null;
}

interface FeasibilityResult {
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
  recommended_goals?: RecommendedGoals;
}

interface RatioRow {
  metric: string;
  current: number;
  goal: number;
  ratio: number;
}

interface ServerSnapshot {
  data: OpsContext;
  applied_at: string | null;
  applied_by_email: string | null;
  applied_by_name: string | null;
  revision: number;
}

interface Props {
  workspace: string;
  ctx: OpsContext;
  serverSnapshot: ServerSnapshot | null;
  filled: number;
  isDirty: boolean;
  /** commit 성공 시 parent state 갱신 */
  onCommitted: (snap: ServerSnapshot) => void;
  /** AI 분석 완료 시 추천 목표값 전달 (parent 가 각 goal 필드에 hint 표시) */
  onRecommendedGoals?: (g: RecommendedGoals) => void;
}

const IMPACT_TONE: Record<string, { color: string; label: string }> = {
  positive: { color: "!text-signal-green", label: "+ 긍정" },
  neutral: { color: "!text-cobalt", label: "○ 중립" },
  negative: { color: "!text-signal-amber", label: "− 부정" },
  blocker: { color: "!text-signal-red", label: "✕ 차단" },
};

const STORAGE_KEY_PREFIX = "kso-growth-feasibility-";

function computeRatios(ctx: OpsContext): RatioRow[] {
  const rows: RatioRow[] = [];
  const checks: Array<{
    metric: string;
    current: number | undefined;
    goal: number | undefined;
  }> = [
    {
      metric: "월 신규 가입",
      current: ctx.new_signups_monthly,
      goal: ctx.goal_new_signups_monthly,
    },
    {
      metric: "월 유료 사용자",
      current: ctx.paid_users_monthly,
      goal: ctx.goal_paid_users_monthly,
    },
    {
      metric: "연 누적 회원",
      current: ctx.total_members ?? ctx.mau,
      goal: ctx.goal_total_members_annual,
    },
    {
      metric: "연 유료 구독자",
      current: ctx.paid_users_monthly,
      goal: ctx.goal_paid_subscribers_annual,
    },
  ];
  for (const c of checks) {
    if (c.current === undefined || c.goal === undefined || c.current <= 0)
      continue;
    const r = c.goal / c.current;
    if (r < 1.2) continue;
    rows.push({
      metric: c.metric,
      current: c.current,
      goal: c.goal,
      ratio: r,
    });
  }
  return rows;
}

function stripMeta(c: OpsContext): OpsContext {
  const { updated_at: _u, ...rest } = c;
  void _u;
  return rest;
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "방금 전";
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ApplyToDiagnosisPanel({
  workspace,
  ctx,
  serverSnapshot,
  filled,
  isDirty,
  onCommitted,
  onRecommendedGoals,
}: Props) {
  const [analysis, setAnalysis] = useState<FeasibilityResult | null>(null);
  const [analyzing, startAnalyzing] = useTransition();
  const [committing, startCommitting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 캐시 로드 — 페이지 재진입 시 마지막 분석 결과 prefill
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${workspace}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { result: FeasibilityResult };
        if (parsed.result) {
          setAnalysis(parsed.result);
          if (parsed.result.recommended_goals && onRecommendedGoals) {
            onRecommendedGoals(parsed.result.recommended_goals);
          }
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // 분석 실행 — draft ctx 를 body 로 전송
  function runAnalysis() {
    setError(null);
    setSuccessMsg(null);
    startAnalyzing(async () => {
      try {
        const res = await fetch(
          `/api/ops-context/${encodeURIComponent(workspace)}/growth-feasibility`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ops: stripMeta(ctx) }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.message ?? "분석 실패");
          return;
        }
        const result = data.result as FeasibilityResult;
        setAnalysis(result);
        // parent 에 추천 목표값 전파
        if (result.recommended_goals && onRecommendedGoals) {
          onRecommendedGoals(result.recommended_goals);
        }
        // 캐시 — 다음 진입 시 prefill
        try {
          localStorage.setItem(
            `${STORAGE_KEY_PREFIX}${workspace}`,
            JSON.stringify({
              result,
              evaluated_at: data.evaluated_at,
            }),
          );
        } catch {}
      } catch (e) {
        setError(String(e));
      }
    });
  }

  // 그대로 반영 — 실제 commit + adapt 트리거
  function commitNow() {
    setError(null);
    setSuccessMsg(null);
    startCommitting(async () => {
      try {
        const res = await fetch(
          `/api/ops-context/${encodeURIComponent(workspace)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: stripMeta(ctx) }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (res.status === 401) {
            setSuccessMsg(
              "로그인 안 됨 — 이 기기에서만 반영됩니다. 팀과 공유하려면 로그인하세요.",
            );
          } else {
            setError(data.message ?? "반영 실패");
            return;
          }
        } else {
          const newSnap: ServerSnapshot = {
            data: stripMeta(ctx),
            applied_at: data.applied_at ?? new Date().toISOString(),
            applied_by_email: data.applied_by_email ?? null,
            applied_by_name: null,
            revision: data.revision ?? 1,
          };
          onCommitted(newSnap);
          setSuccessMsg(
            data.changes_count > 0
              ? `${data.changes_count}개 항목이 진단·워크리스트에 반영되었습니다.`
              : "변경 사항 없음 — 이미 최신 상태입니다.",
          );
        }
      } catch (e) {
        setError(String(e));
        return;
      }
      // adapt 트리거
      try {
        window.dispatchEvent(
          new StorageEvent("storage", { key: `kso-ops-context-${workspace}` }),
        );
        window.dispatchEvent(
          new CustomEvent("ops-context:applied", { detail: { workspace } }),
        );
      } catch {}
    });
  }

  const ratios = computeRatios(ctx);
  const hasResult = analysis !== null;
  const isCommittedAndClean =
    !isDirty && serverSnapshot && serverSnapshot.revision > 0;

  // "목표 수정" 버튼 — 03 성장 목표 섹션으로 부드러운 스크롤 + 1.2초 highlight
  function scrollToGoals() {
    if (typeof window === "undefined") return;
    const el = document.getElementById("section-growth-goals");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add(
      "ring-2",
      "ring-accent",
      "ring-offset-2",
      "ring-offset-paper",
    );
    window.setTimeout(() => {
      el.classList.remove(
        "ring-2",
        "ring-accent",
        "ring-offset-2",
        "ring-offset-paper",
      );
    }, 1500);
  }

  return (
    <div className="mt-10 pt-6 border-t-2 border-ink">
      {/* Header */}
      <div className="mb-3">
        <p className="kicker mb-1">진단·워크리스트에 적용</p>
        <h3 className="font-display text-xl leading-tight">
          입력한 데이터로{" "}
          <span className="italic font-light">진단을 맞춤화</span>
        </h3>
        <p className="mt-1 text-sm text-ink-soft leading-relaxed max-w-2xl">
          "진단에 반영" 을 누르면 AI 가 현황·목표·정체성·자원·경쟁을 분석해
          가능성 시나리오를 보여줍니다. 결과를 확인 후 "그대로 반영" 으로
          진단 카드·워크리스트에 실제 적용됩니다.
        </p>
      </div>

      {/* 초기 상태: "진단에 반영" 1버튼 (분석 시작) */}
      {!hasResult && !analyzing ? (
        <div className="mt-5 flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            {isCommittedAndClean ? (
              <p className="label-mono text-signal-green">
                ✓ 이미 반영됨 ·{" "}
                {serverSnapshot.applied_at
                  ? formatDateTime(new Date(serverSnapshot.applied_at))
                  : "—"}{" "}
                · revision {serverSnapshot.revision}
              </p>
            ) : isDirty && serverSnapshot && serverSnapshot.revision > 0 ? (
              <p className="label-mono !text-signal-amber">
                변경 사항 있음 — 다시 분석 후 반영하세요
              </p>
            ) : (
              <p className="label-mono text-ink-soft">
                아직 분석 안 됨 — 위 입력값으로 가능성을 분석합니다
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={runAnalysis}
            disabled={filled === 0}
            className="btn-primary disabled:opacity-50 shrink-0 inline-flex items-center gap-2"
          >
            <span>진단에 반영</span>
            <span className="font-mono text-xs">→</span>
          </button>
        </div>
      ) : null}

      {/* 로딩 상태 */}
      {analyzing ? (
        <div className="mt-5 border-2 border-ink bg-paper-soft p-6 flex items-center gap-4">
          <span
            aria-hidden="true"
            className="inline-block w-5 h-5 border-2 border-ink border-t-transparent rounded-full animate-spin shrink-0"
          />
          <div>
            <p className="font-display text-lg leading-tight">
              AI 가 분석 중…
            </p>
            <p className="label-mono text-ink-soft mt-0.5">
              현황 대비 목표·시간·자본·인력·경쟁을 종합 평가 — 10~30초
            </p>
          </div>
        </div>
      ) : null}

      {/* 분석 결과 + 액션 버튼 */}
      {hasResult && analysis ? (
        <AnalysisResult
          analysis={analysis}
          ratios={ratios}
          onCommit={commitNow}
          onEditGoals={scrollToGoals}
          committing={committing}
          analyzing={analyzing}
          committed={isCommittedAndClean}
          serverSnapshot={serverSnapshot}
          successMsg={successMsg}
          error={error}
        />
      ) : null}

      {/* 분석 실패 시 (결과 없을 때) */}
      {error && !analyzing && !hasResult ? (
        <div className="mt-4 border-2 border-signal-red/40 bg-soft-red/10 p-4">
          <p className="font-mono text-xs text-signal-red mb-2">⚠ {error}</p>
          <button
            type="button"
            onClick={runAnalysis}
            className="label-mono hover:text-ink border border-ink-soft/40 px-2 py-1 hover:border-ink"
          >
            다시 시도
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AnalysisResult({
  analysis,
  ratios,
  onCommit,
  onEditGoals,
  committing,
  analyzing,
  committed,
  serverSnapshot,
  successMsg,
  error,
}: {
  analysis: FeasibilityResult;
  ratios: RatioRow[];
  onCommit: () => void;
  onEditGoals: () => void;
  committing: boolean;
  analyzing: boolean;
  committed: boolean | null | "" | undefined;
  serverSnapshot: ServerSnapshot | null;
  successMsg: string | null;
  error: string | null;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(analysis.feasibility_pct)));
  const tone =
    pct >= 60
      ? "text-signal-green"
      : pct >= 30
        ? "text-signal-amber"
        : "text-signal-red";

  return (
    <div className="mt-5 border-2 border-ink bg-paper p-5 sm:p-6 space-y-6">
      {/* 가능성 점수 + summary */}
      <div className="flex items-baseline gap-5 flex-wrap">
        <div>
          <p className="kicker mb-1">현 상태 유지 시 달성 가능성</p>
          <p className={`font-display text-6xl leading-none ${tone}`}>
            {pct}
            <span className="font-mono text-2xl text-ink-soft ml-1">%</span>
          </p>
        </div>
        <p className="text-sm leading-relaxed flex-1 min-w-[16rem]">
          {analysis.summary}
        </p>
      </div>

      {/* 목표 격차 inline */}
      {ratios.length > 0 ? (
        <div className="pt-5 border-t border-ink-soft/30">
          <p className="kicker mb-2">목표 격차</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {ratios.map((r, i) => {
              const dotColor =
                r.ratio >= 20
                  ? "bg-signal-red/60"
                  : r.ratio >= 5
                    ? "bg-signal-amber/60"
                    : "bg-cobalt/50";
              return (
                <li
                  key={i}
                  className="label-mono flex items-baseline gap-2"
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor} self-center`}
                    aria-hidden="true"
                  />
                  <span className="text-ink">{r.metric}</span>
                  <span className="opacity-50">·</span>
                  <span>
                    {r.current.toLocaleString("ko-KR")} →{" "}
                    {r.goal.toLocaleString("ko-KR")}
                  </span>
                  <span className="opacity-50">·</span>
                  <span className="font-bold">{r.ratio.toFixed(1)}배</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* 핵심 요인 */}
      <div className="pt-5 border-t border-ink-soft/30">
        <p className="kicker mb-2">핵심 요인</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {analysis.key_factors.map((f, i) => {
            const t = IMPACT_TONE[f.impact] ?? IMPACT_TONE.neutral;
            return (
              <li
                key={i}
                className="border-l-4 pl-3 py-2 bg-paper-soft border-ink-soft/40"
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
      <div className="pt-5 border-t border-ink-soft/30">
        <p className="kicker mb-2">시나리오 — 어떻게 가능성을 높일 수 있나</p>
        <ol className="space-y-3">
          {analysis.scenarios.map((s, i) => {
            const p = Math.max(0, Math.min(100, Math.round(s.probability_pct)));
            const sTone =
              p >= 60
                ? "border-signal-green"
                : p >= 30
                  ? "border-signal-amber"
                  : "border-signal-red";
            const pTone =
              p >= 60
                ? "text-signal-green"
                : p >= 30
                  ? "text-signal-amber"
                  : "text-signal-red";
            return (
              <li key={i} className={`border-2 ${sTone} bg-paper-soft p-4`}>
                <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                  <h4 className="font-display text-base leading-tight">
                    <span className="text-ink-soft mr-2">시나리오 {i + 1}</span>
                    {s.label}
                  </h4>
                  <span className={`font-display text-xl ${pTone}`}>{p}%</span>
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
      {analysis.caveats.length > 0 ? (
        <div className="pt-4 border-t border-ink-soft/30">
          <p className="kicker mb-1">한계·주의</p>
          <ul className="space-y-1">
            {analysis.caveats.map((c, i) => (
              <li key={i} className="label-mono text-ink-soft leading-relaxed">
                · {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 액션 버튼 행 */}
      <div className="pt-5 border-t-2 border-ink space-y-3">
        {successMsg ? (
          <div className="border border-signal-green/50 bg-soft-green/15 px-3 py-2 inline-flex items-baseline gap-2 flex-wrap">
            <span className="kicker !text-signal-green">✓ 반영됨</span>
            {serverSnapshot?.applied_at ? (
              <>
                <span className="font-mono text-sm text-ink">
                  {formatDateTime(new Date(serverSnapshot.applied_at))}
                </span>
                <span className="label-mono opacity-50">·</span>
                <span className="label-mono">
                  {serverSnapshot.applied_by_name ??
                    serverSnapshot.applied_by_email?.split("@")[0] ??
                    "익명"}
                </span>
                <span className="label-mono opacity-50">·</span>
                <span className="label-mono text-ink-soft">
                  {formatRelative(new Date(serverSnapshot.applied_at))}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="font-mono text-xs text-signal-red">⚠ {error}</p>
        ) : null}

        <div className="flex items-baseline gap-3 flex-wrap">
          <button
            type="button"
            onClick={onCommit}
            disabled={committing || analyzing || Boolean(committed)}
            className="btn-primary disabled:opacity-50 inline-flex items-center gap-2"
            title={
              committed
                ? "이미 최신 상태로 반영됨"
                : "이 분석을 진단·워크리스트에 반영"
            }
          >
            {committing ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block w-3 h-3 border-2 border-paper border-t-transparent rounded-full animate-spin"
                />
                <span>반영 중…</span>
              </>
            ) : committed ? (
              <span>✓ 반영됨</span>
            ) : (
              <>
                <span>그대로 반영</span>
                <span className="font-mono text-xs">→</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onEditGoals}
            disabled={committing}
            className="btn-secondary disabled:opacity-50 inline-flex items-center gap-2"
            title="위 분석의 추천 목표를 보며 03 성장 목표 섹션에서 수정"
          >
            <span aria-hidden="true">↑</span>
            <span>목표 수정</span>
          </button>
          <span className="label-mono text-ink-soft ml-auto">
            "그대로 반영" = 진단·워크리스트 갱신 ·  "목표 수정" = 03 섹션에서
            AI 추천값 보며 재입력
          </span>
        </div>
      </div>
    </div>
  );
}

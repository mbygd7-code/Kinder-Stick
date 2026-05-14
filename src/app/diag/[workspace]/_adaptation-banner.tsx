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
import type { AdaptationOutput, AdaptedDomain } from "@/lib/ops-context/adapt";
import {
  computeOpsContextAdaptation,
  loadOpsContextFromLocalStorage,
} from "@/lib/ops-context/adapt";

// Domain 코드 → 한글 라벨 (질문은행에서 가져올 수도 있지만 lightweight 로 inline)
const DOMAIN_LABEL: Record<string, string> = {
  A1: "시장-문제 적합성",
  A2: "PMF (제품-시장 적합성)",
  A3: "결정자 ROI (교사)",
  A4: "사용자 활성화·유지",
  A6: "획득 채널 (GTM)",
  A7: "신뢰·안전·규제",
  A8: "학습·실행 속도",
  A9: "AI 시대 고도화",
  A10: "마케팅·영업 실행력",
  A11: "팀·리더십·문화",
  A13: "CS·NPS·고객성공",
  A14: "경쟁·시장 인텔리전스",
};

const SEVERITY_TONE: Record<string, string> = {
  high: "border-signal-red bg-soft-red/15 text-signal-red",
  medium: "border-signal-amber bg-soft-amber/20 text-signal-amber",
  low: "border-cobalt bg-soft-cobalt/20 text-cobalt",
};
const SEVERITY_LABEL: Record<string, string> = {
  high: "★ 우선",
  medium: "● 권장",
  low: "○ 참고",
};

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

  if (!adapt || !adapt.has_signal) return null;

  const top = adapt.emphasized.slice(0, 5);
  const realism = adapt.realism_warnings;

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8 space-y-4">
      {/* 강조 도메인 카드 */}
      {top.length > 0 ? (
        <div className="border-2 border-ink bg-paper-soft p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <div>
              <p className="kicker mb-1">회사 컨디션 반영</p>
              <h3 className="font-display text-xl sm:text-2xl leading-tight">
                이 {context === "diagnosis" ? "진단" : "워크리스트"} 는 다음
                영역을{" "}
                <span className="italic font-light">우선</span> 점검하세요
              </h3>
            </div>
            <span className="label-mono">
              {top.length}개 영역 강조 · 운영 숫자·목표 기반
            </span>
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">
            {top.map((d) => (
              <DomainCard key={d.domain} d={d} />
            ))}
          </ul>

          <p className="mt-4 label-mono text-ink-soft leading-relaxed">
            ↳ 위 영역의{" "}
            {context === "diagnosis" ? "진단 sub-item" : "워크리스트 업무"} 가
            자동으로 강조됩니다. 운영 숫자나 목표를 수정하면 즉시 갱신됨.
          </p>
        </div>
      ) : null}

      {/* 현실성 경고 */}
      {realism.length > 0 ? (
        <div className="border-2 border-signal-amber bg-soft-amber/30 p-5">
          <div className="flex items-baseline gap-2 flex-wrap mb-2">
            <p className="kicker !text-signal-amber">⚠ 목표 현실성 경고</p>
            <span className="label-mono">{realism.length}건</span>
          </div>
          <p className="text-sm leading-relaxed mb-3">
            아래 목표는 현재 규모 대비 과도해 진단 결과의 신뢰도가 떨어질 수
            있습니다. 진단 점수가 빨강이라도 실제 위험이 아닐 수 있으니
            목표 재현실화 또는 점수 보정 권장.
          </p>
          <ul className="space-y-2">
            {realism.map((w, i) => (
              <li
                key={i}
                className={`border-l-4 pl-3 py-1.5 bg-paper ${
                  w.severity === "extreme"
                    ? "border-signal-red"
                    : "border-signal-amber"
                }`}
              >
                <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
                  <span
                    className={`label-mono ${
                      w.severity === "extreme"
                        ? "!text-signal-red"
                        : "!text-signal-amber"
                    }`}
                  >
                    {w.severity === "extreme" ? "✕ 매우 비현실적" : "⚠ 도전적"}
                  </span>
                  <span className="font-mono text-sm text-ink">
                    {w.metric}
                  </span>
                  <span className="label-mono opacity-50">·</span>
                  <span className="label-mono">
                    {w.current.toLocaleString("ko-KR")} →{" "}
                    {w.goal.toLocaleString("ko-KR")} ({w.ratio.toFixed(1)}배)
                  </span>
                </div>
                <p className="label-mono text-ink-soft leading-relaxed">
                  {w.message}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function DomainCard({ d }: { d: AdaptedDomain }) {
  const tone = SEVERITY_TONE[d.severity];
  const sev = SEVERITY_LABEL[d.severity];
  const label = DOMAIN_LABEL[d.domain] ?? d.domain;
  return (
    <li
      className={`border-l-4 ${tone.split(" ")[0]} pl-3 py-2 bg-paper`}
      title={d.reasons.join("\n")}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="label-mono">{d.domain}</span>
        <span className={`label-mono ${tone.split(" ")[2]}`}>{sev}</span>
      </div>
      <p className="font-display text-sm leading-tight mt-0.5">{label}</p>
      {d.reasons[0] ? (
        <p className="label-mono text-ink-soft mt-1 leading-relaxed line-clamp-2">
          {d.reasons[0]}
        </p>
      ) : null}
    </li>
  );
}

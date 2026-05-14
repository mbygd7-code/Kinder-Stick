"use client";

/**
 * 진단 응답 페이지 shell.
 *
 * 역할 분리:
 *   /diag/[ws]      — (이 파일) 진단 응답 작성 + 운영 컨텍스트 입력 + 이전 이력
 *   /diag/[ws]/home — 운영 hub (점수·이번 주 할 일·도메인 신호등)
 *
 * 제출 흐름:
 *   응답 제출 → 자동으로 /home 으로 이동 → 결과·다음 액션은 home 에서 확인.
 *   이 페이지에서는 결과 인라인 표시 안 함 (홈과 중복 방지).
 */

import { useState } from "react";
import type { FrameworkConfig } from "@/lib/framework/loader";
import {
  DiagnosisForm,
  type DiagnosisSubmitResult,
} from "./_diagnosis-form";
import { OpsContextSection } from "./_ops-context-section";
import { HistorySection } from "./_history-section";
import { DiagnosisAdaptEmphasisApplier } from "./_diagnosis-adapt-emphasis";
import { DiagnosisProfileProvider } from "./_diagnosis-profile-provider";

interface Props {
  workspace: string;
  framework: FrameworkConfig;
}

export function UnifiedDiagnosisShell({ workspace, framework }: Props) {
  const [submittedOk, setSubmittedOk] = useState(false);

  function handleSubmitted(r: DiagnosisSubmitResult) {
    console.log("[diagnosis] submitted:", r);
    if (r.ok) {
      setSubmittedOk(true);
      // RSC 캐시 우회를 위해 hard navigation 으로 즉시 이동.
      // router.push 는 soft navigation 이라 home 페이지 SSR 캐시가
      // 새 진단을 즉시 반영하지 못해 stale 화면이 보일 수 있음.
      const target = `/diag/${workspace}/home?just_submitted=1`;
      // 짧은 사용자 피드백을 위해 0.4s 지연 후 hard navigation
      setTimeout(() => {
        window.location.href = target;
      }, 400);
    }
  }

  return (
    <DiagnosisProfileProvider workspace={workspace}>
      {/* (A) 운영 컨텍스트 — 진단 폼 위 (안에 통합 ApplyToDiagnosisPanel 포함) */}
      <OpsContextSection workspace={workspace} />

      {/* (B) 진단 응답 폼 — Provider 가 OpsContext → DiagnosisProfile 변환·주입 */}
      <DiagnosisForm
        workspace={workspace}
        framework={framework}
        onSubmitted={handleSubmitted}
        redirectAfterSubmit={false}
      />

      {/* 제출 직후 안내 (자동 이동) */}
      {submittedOk ? (
        <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-6">
          <div className="border-2 border-signal-green bg-soft-green/30 p-5 sm:p-6 text-center">
            <p className="kicker !text-signal-green mb-1">제출 완료</p>
            <h3 className="font-display text-xl sm:text-2xl leading-tight">
              결과 페이지로 이동 중…
            </h3>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              종합 점수·이번 주 할 일·도메인 신호등을 홈에서 확인하세요.
            </p>
            <a
              href={`/diag/${workspace}/home`}
              className="btn-primary mt-4 inline-flex"
            >
              지금 바로 보기 →
            </a>
          </div>
        </section>
      ) : null}

      {/* (D) 이전 진단 이력 — 항상 표시 (첫 진단이면 자동 숨김) */}
      <HistorySection workspace={workspace} />

      {/* CLIENT — OpsContext 강조 도메인의 진단 sub-item section 에 시각 강조 */}
      <DiagnosisAdaptEmphasisApplier workspace={workspace} />
    </DiagnosisProfileProvider>
  );
}

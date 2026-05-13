"use client";

/**
 * 인라인 결과 패널 — 진단 제출 직후 같은 페이지에 결과 요약 노출.
 * 깊이 보기는 /result 별도 페이지.
 */

interface InlineResultProps {
  workspace: string;
  /** /api/diagnosis/submit 의 result 필드 (jsonb) */
  result: {
    overall_score?: number;
    domain_scores?: Array<{ domain: string; score: number | null }>;
    failure_probability?: {
      "6m"?: { final?: number; prior?: number };
      "12m"?: { final?: number; prior?: number };
    };
    red_critical_codes?: string[];
  };
  respondentNum?: number;
  sessionId?: string;
  /** 한국어 도메인 이름 매핑 */
  domainNameMap?: Record<string, string>;
}

export function InlineResult({
  workspace,
  result,
  respondentNum,
  domainNameMap = {},
}: InlineResultProps) {
  const overall = result.overall_score ?? null;
  const fp6m = result.failure_probability?.["6m"]?.final ?? null;
  const fp12m = result.failure_probability?.["12m"]?.final ?? null;
  const redCritical = result.red_critical_codes ?? [];

  const overallTone =
    overall === null
      ? "neutral"
      : overall >= 70
        ? "green"
        : overall >= 40
          ? "amber"
          : "red";

  const overallLabel =
    overallTone === "green"
      ? "양호"
      : overallTone === "amber"
        ? "주의"
        : overallTone === "red"
          ? "위험"
          : "평가 보류";

  const verdictSentence =
    overall === null
      ? "응답이 부족해 점수를 산출하지 못했습니다."
      : overall >= 70
        ? "지금 흐름을 이어가도 좋습니다. 정기 점검은 계속 유지하세요."
        : overall >= 40
          ? "한두 영역이 흔들리고 있습니다. 빨간 영역부터 우선 점검."
          : "여러 영역이 위험 수준입니다. 이번 주 안에 책임자 지정 + 액션 채택이 필요합니다.";

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-6">
      <div
        className={`border-2 p-6 sm:p-8 ${
          overallTone === "red"
            ? "border-signal-red bg-soft-red/30"
            : overallTone === "amber"
              ? "border-signal-amber bg-soft-amber/30"
              : overallTone === "green"
                ? "border-signal-green bg-soft-green/30"
                : "border-ink bg-paper-soft"
        }`}
      >
        {/* 헤더 */}
        <div className="flex items-baseline gap-3 mb-3 flex-wrap">
          <span
            className={`tag ${
              overallTone === "red"
                ? "tag-red"
                : overallTone === "amber"
                  ? "tag-gold"
                  : overallTone === "green"
                    ? "tag-green"
                    : "tag-filled"
            }`}
          >
            ● {overallLabel}
          </span>
          <p className="kicker">방금 제출한 진단 결과</p>
          {respondentNum ? (
            <span className="label-mono">응답 #{respondentNum}번</span>
          ) : null}
        </div>

        {/* 큰 숫자 */}
        <h2 className="font-display text-3xl sm:text-5xl leading-tight tracking-tight">
          종합 건강도{" "}
          <span
            className={
              overallTone === "red"
                ? "text-signal-red"
                : overallTone === "amber"
                  ? "text-signal-amber"
                  : overallTone === "green"
                    ? "text-signal-green"
                    : "text-ink"
            }
          >
            {overall === null ? "—" : Math.round(overall)}
          </span>
          <span className="text-ink-soft text-2xl"> / 100</span>
        </h2>
        <p className="mt-3 text-base leading-relaxed text-ink-soft max-w-2xl">
          {verdictSentence}
        </p>

        {/* 확률 2개 */}
        <div className="mt-5 pt-4 border-t border-ink-soft/30 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <p className="kicker mb-1">6개월 안 어려움 가능성</p>
            <p className="font-display leading-none">
              <span
                className={`text-4xl sm:text-5xl ${
                  fp6m && fp6m >= 0.45
                    ? "text-signal-red"
                    : fp6m && fp6m >= 0.25
                      ? "text-signal-amber"
                      : "text-signal-green"
                }`}
              >
                {fp6m === null ? "—" : Math.round(fp6m * 100)}
              </span>
              <span className="text-xl text-ink">%</span>
            </p>
          </div>
          <div>
            <p className="kicker mb-1">12개월 안 어려움 가능성</p>
            <p className="font-display leading-none">
              <span
                className={`text-4xl sm:text-5xl ${
                  fp12m && fp12m >= 0.55
                    ? "text-signal-red"
                    : fp12m && fp12m >= 0.35
                      ? "text-signal-amber"
                      : "text-signal-green"
                }`}
              >
                {fp12m === null ? "—" : Math.round(fp12m * 100)}
              </span>
              <span className="text-xl text-ink">%</span>
            </p>
          </div>
        </div>

        {/* 빨간 critical 영역 */}
        {redCritical.length > 0 ? (
          <div className="mt-5 pt-4 border-t border-ink-soft/30">
            <p className="kicker !text-signal-red mb-2">
              ! 즉시 점검 필요 ({redCritical.length}개 영역)
            </p>
            <ul className="flex flex-wrap gap-2">
              {redCritical.map((code) => (
                <li key={code}>
                  <a
                    href={`/diag/${workspace}/coach/${code}`}
                    className="tag tag-red hover:bg-signal-red hover:text-paper transition-colors"
                  >
                    {code}
                    {domainNameMap[code] ? ` · ${domainNameMap[code]}` : ""} →
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* 깊이 보기 + 다음 액션 */}
        <div className="mt-6 pt-5 border-t border-ink-soft/30 flex flex-wrap gap-3">
          <a
            href={`/diag/${workspace}/home`}
            className="px-4 py-2 border-2 border-ink bg-ink text-paper text-sm font-medium hover:bg-paper hover:text-ink transition-colors"
          >
            홈에서 이번 주 할 일 보기 →
          </a>
          <a
            href={`/diag/${workspace}/result`}
            className="px-4 py-2 border-2 border-ink-soft text-sm font-medium hover:border-ink hover:bg-paper-deep/40 transition-colors"
          >
            상세 리포트 (8요인 분해) →
          </a>
          <a
            href={`/diag/${workspace}/worklist`}
            className="px-4 py-2 border-2 border-ink-soft text-sm font-medium hover:border-ink hover:bg-paper-deep/40 transition-colors"
          >
            워크리스트 실행 →
          </a>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  KpiSnapshot,
  SignalEvent,
  MetricDefinition,
} from "./page";

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

interface InjectResult {
  ok: boolean;
  narrative?: string;
  bucket?: { v: number; severity: "red" | "amber" | "green"; label: string };
  mapped_sub_item?: string;
  message?: string;
}

interface ProactiveResult {
  ok: boolean;
  total_candidates?: number;
  processed_now?: number;
  already_processed?: number;
  results?: Array<{
    signal_id: string;
    session_id: string | null;
    applied: boolean;
    finding: string | null;
  }>;
  message?: string;
}

const PRESETS: Array<{
  label: string;
  source: string;
  metric_key: string;
  value: number;
  hint: string;
  severity: "red" | "amber" | "green";
}> = [
  {
    label: "D1 활성화 18%",
    source: "ga4",
    metric_key: "d1_activation_rate",
    value: 0.18,
    hint: "사용자 활성화 빨강 (A4)",
    severity: "red",
  },
  {
    label: "D1 활성화 52%",
    source: "ga4",
    metric_key: "d1_activation_rate",
    value: 0.52,
    hint: "사용자 활성화 양호 (A4)",
    severity: "green",
  },
  {
    label: "M3 retention 12%",
    source: "mixpanel",
    metric_key: "m3_retention_rate",
    value: 0.12,
    hint: "가짜 PMF 위험 (A2)",
    severity: "red",
  },
  {
    label: "M3 retention 48%",
    source: "mixpanel",
    metric_key: "m3_retention_rate",
    value: 0.48,
    hint: "PMF 양호 (A2)",
    severity: "green",
  },
  {
    label: "교사 NPS -5",
    source: "channeltalk",
    metric_key: "nps",
    value: -5,
    hint: "고객 만족도 빨강 (A13)",
    severity: "red",
  },
  {
    label: "교사 NPS 52",
    source: "channeltalk",
    metric_key: "nps",
    value: 52,
    hint: "고객 만족도 양호 (A13)",
    severity: "green",
  },
];

// ============================================================
// Signal humanizer — raw narrative → 직원이 읽기 쉬운 구조
// ============================================================

interface HumanizedSignal {
  type:
    | "kpi_update"
    | "session_abandoned"
    | "coach_finding"
    | "quarterly_due"
    | "other";
  tone: "red" | "amber" | "green" | "neutral";
  headline: string; // 한 줄 핵심 — 14자 이내
  body: string; // 풀어쓴 설명 한 문장
  metricLine?: string; // 측정값·출처·시점 메타
  cta?: { label: string; href: string };
  rawNarrative: string;
}

function humanizeSignal(
  ev: SignalEvent,
  workspace: string,
  domainNameMap: Record<string, string>,
): HumanizedSignal {
  const meta = (ev.metadata ?? {}) as Record<string, unknown>;
  const domainName = ev.domain_code
    ? (domainNameMap[ev.domain_code] ?? ev.domain_code)
    : "";
  const tone: HumanizedSignal["tone"] =
    ev.severity >= 4 ? "red" : ev.severity >= 3 ? "amber" : "neutral";

  // 1) Coach finding (metadata 에 processed_session_id 있음)
  const processedSessionId =
    typeof meta.processed_session_id === "string"
      ? (meta.processed_session_id as string)
      : null;
  const findingExcerpt =
    typeof meta.processed_finding_excerpt === "string"
      ? (meta.processed_finding_excerpt as string)
      : null;
  if (processedSessionId && ev.domain_code) {
    return {
      type: "coach_finding",
      tone: "green",
      headline: `${ev.domain_code} 코치 진단 도착`,
      body:
        findingExcerpt ??
        `${domainName} 영역의 코치 진단이 준비되었습니다. SMART 액션을 확인하세요.`,
      metricLine: `${domainName} · ${formatTime(ev.created_at)}`,
      cta: {
        label: "코치 진단 보기",
        href: `/diag/${workspace}/coach/${ev.domain_code}`,
      },
      rawNarrative: ev.narrative,
    };
  }

  // 2) Session abandoned
  if (ev.narrative.startsWith("SESSION ABANDONED")) {
    const summary = extractSummary(ev.narrative);
    return {
      type: "session_abandoned",
      tone: "amber",
      headline: `${ev.domain_code ?? ""} 코치 세션 방치됨`,
      body:
        summary ??
        "14일 넘게 진행 없는 코치 세션입니다. 액션이 채택되지 않았거나, 채택된 액션이 마감 임박합니다.",
      metricLine: ev.domain_code
        ? `${domainName} · 14일 idle`
        : "14일 idle",
      cta: ev.domain_code
        ? {
            label: "코치 다시 시작",
            href: `/diag/${workspace}/coach/${ev.domain_code}`,
          }
        : undefined,
      rawNarrative: ev.narrative,
    };
  }

  // 3) Quarterly due
  if (ev.narrative.startsWith("QUARTERLY DUE")) {
    const days = ev.narrative.match(/마지막 진단 (\d+)일 전/);
    return {
      type: "quarterly_due",
      tone: "amber",
      headline: "분기 진단 권장",
      body: days
        ? `마지막 진단이 ${days[1]}일 전입니다. KPI/시장 변동이 점수에 반영되지 않아 코치 정확도가 떨어집니다. 재진단을 권장합니다.`
        : "분기 재진단을 권장합니다.",
      metricLine: `${formatTime(ev.created_at)}`,
      cta: {
        label: "재진단 시작",
        href: `/diag/${workspace}`,
      },
      rawNarrative: ev.narrative,
    };
  }

  // 4) KPI update — `source.metric = value → SUB.CODE BAND (...)` 패턴
  const kpiMatch = ev.narrative.match(
    /^([a-z0-9_]+)\.([a-z0-9_]+)\s*=\s*([\d.%-]+(?:\s*%)?)\s*→\s*([A-Z0-9.]+)\s+(GREEN|AMBER|RED)\b/i,
  );
  if (kpiMatch) {
    const [, source, metric, value, , band] = kpiMatch;
    const bandTone: HumanizedSignal["tone"] =
      band.toUpperCase() === "RED"
        ? "red"
        : band.toUpperCase() === "AMBER"
          ? "amber"
          : "green";
    const subjectKo = metricLabel(source, metric, value);
    const interpretation = bandInterpretation(band, ev.narrative);
    return {
      type: "kpi_update",
      tone: bandTone,
      headline: `${ev.domain_code ?? ""} · ${subjectKo}`,
      body: interpretation,
      metricLine: `${sourceLabel(source)} · ${formatTime(ev.created_at)}`,
      cta:
        bandTone !== "green" && ev.domain_code
          ? {
              label: "코치와 상담",
              href: `/diag/${workspace}/coach/${ev.domain_code}`,
            }
          : undefined,
      rawNarrative: ev.narrative,
    };
  }

  // fallback
  return {
    type: "other",
    tone,
    headline: ev.domain_code ?? "시그널",
    body: ev.narrative,
    metricLine: `${formatTime(ev.created_at)}${
      ev.domain_code ? ` · ${domainName}` : ""
    }`,
    cta:
      ev.domain_code && ev.severity >= 3
        ? {
            label: "코치와 상담",
            href: `/diag/${workspace}/coach/${ev.domain_code}`,
          }
        : undefined,
    rawNarrative: ev.narrative,
  };
}

function extractSummary(narrative: string): string | null {
  const m = narrative.match(/summary:\s*"([^"]+)"/);
  return m ? m[1].replace(/…$|\s*\.\.\.$/, "") + (m[1].endsWith("…") ? "…" : "") : null;
}

function metricLabel(
  source: string,
  metric: string,
  value: string,
): string {
  const key = `${source}.${metric}`;
  const KO: Record<string, string> = {
    "ga4.d1_activation_rate": `D1 활성화율 ${value}`,
    "ga4.wau": `WAU ${value}`,
    "ga4.dau": `DAU ${value}`,
    "ga4.mau": `MAU ${value}`,
    "ga4.new_users_weekly": `신규 가입 (주간) ${value}`,
    "ga4.channel_share_paid": `유료 채널 비중 ${value}`,
    "ga4.channel_share_direct": `직접 유입 비중 ${value}`,
    "mixpanel.m3_retention_rate": `3개월 retention ${value}`,
    "mixpanel.m1_retention_rate": `1개월 retention ${value}`,
    "channeltalk.nps": `교사 NPS ${value}`,
    "admin.new_signups_weekly": `주간 신규 가입 ${value}`,
    "admin.cumulative_revenue": `누적 매출 ${value}`,
    "stripe.cancel_rate": `결제 취소율 ${value}`,
    "toss.cancel_rate": `결제 취소율 ${value}`,
  };
  return KO[key] ?? `${metric} ${value}`;
}

function sourceLabel(source: string): string {
  return (
    {
      ga4: "Google Analytics",
      mixpanel: "Mixpanel",
      channeltalk: "ChannelTalk",
      admin: "Admin DB",
      stripe: "Stripe",
      toss: "Toss Payments",
      slack: "Slack",
      github: "GitHub",
      linear: "Linear",
      hubspot: "HubSpot",
    }[source] ?? source
  );
}

function bandInterpretation(band: string, narrative: string): string {
  const b = band.toUpperCase();
  // 괄호 안 부연 설명 추출
  const paren = narrative.match(/\(([^)]+)\)/);
  const detail = paren ? paren[1] : "";

  if (b === "RED") {
    if (detail.includes("가짜 PMF")) {
      return "사용자가 3개월 후 거의 떠나고 있습니다 ('가짜 PMF' 구간). 핵심 세그먼트 재정의가 필요합니다.";
    }
    if (detail.includes("M3 < 15")) {
      return "월 3차 retention 이 15% 미만으로 떨어졌습니다. 사용자가 단기로만 머물고 있는 신호입니다.";
    }
    if (detail.includes("D1") && detail.includes("<")) {
      return "신규 사용자의 첫날 활성화가 20% 미만입니다. 온보딩 또는 첫 가치 전달이 막혀 있습니다.";
    }
    if (detail.includes("NPS")) {
      return "교사 NPS가 0 미만입니다. detractor 가 promoter 보다 많은 상태이므로 즉시 인터뷰가 필요합니다.";
    }
    return "측정값이 빨간 임계를 넘었습니다. 즉시 점검이 필요합니다.";
  }
  if (b === "AMBER") {
    return "측정값이 주의 구간에 있습니다. 추세를 1–2주 더 지켜보거나 미리 점검할 수 있습니다.";
  }
  // GREEN
  return "측정값이 양호 구간입니다. 현재 흐름을 유지하세요.";
}

// 시그널을 카테고리별로 그룹화 (요약 카드 + 상세 목록)
function groupByTone(
  signals: HumanizedSignal[],
): Record<HumanizedSignal["tone"], HumanizedSignal[]> {
  const groups: Record<HumanizedSignal["tone"], HumanizedSignal[]> = {
    red: [],
    amber: [],
    green: [],
    neutral: [],
  };
  for (const s of signals) groups[s.tone].push(s);
  return groups;
}

// ============================================================
// Component
// ============================================================

export function SignalsClient({
  workspace,
  orgFound,
  snapshots,
  events,
  metricDefs,
  domainNameMap,
  showMockInjector = false,
}: {
  workspace: string;
  orgFound: boolean;
  snapshots: KpiSnapshot[];
  events: SignalEvent[];
  metricDefs: MetricDefinition[];
  domainNameMap: Record<string, string>;
  showMockInjector?: boolean;
}) {
  const router = useRouter();
  const [pending, startInject] = useTransition();
  const [proactivePending, startProactive] = useTransition();
  const [lastResult, setLastResult] = useState<InjectResult | null>(null);
  const [proactiveResult, setProactiveResult] = useState<ProactiveResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "red" | "amber" | "green">("all");
  const [showRaw, setShowRaw] = useState(false);

  function runProactive() {
    setError(null);
    startProactive(async () => {
      try {
        const res = await fetch("/api/cron/proactive-coach", {
          method: "POST",
        });
        const json: ProactiveResult = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message ?? "proactive 호출 실패");
          return;
        }
        setProactiveResult(json);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function inject(preset: (typeof PRESETS)[number]) {
    setError(null);
    startInject(async () => {
      try {
        const res = await fetch("/api/admin/inject-kpi", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspace,
            source: preset.source,
            metric_key: preset.metric_key,
            value: preset.value,
          }),
        });
        const json: InjectResult = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message ?? "주입 실패");
          return;
        }
        setLastResult(json);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // 시그널 humanize + 필터링
  const humanized = events.map((ev) =>
    humanizeSignal(ev, workspace, domainNameMap),
  );
  const grouped = groupByTone(humanized);
  const filtered =
    filter === "all"
      ? humanized
      : humanized.filter((s) => s.tone === filter);

  return (
    <main className="min-h-dvh w-full pb-20">
      {/* MASTHEAD */}
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <a
              href={`/diag/${workspace}/home`}
              className="kicker hover:text-ink"
            >
              ← 홈
            </a>
            <span className="hidden sm:inline label-mono opacity-50">·</span>
            <span className="hidden sm:inline label-mono">
              {workspace} · signals
            </span>
          </div>
          <span className="label-mono">SIGNAL FEED</span>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-4">자동 측정 신호</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight break-keep">
          시그널{" "}
          <span className="text-accent italic font-display">피드</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          외부 KPI 변동·코치 진단 완료·세션 방치·분기 만료를 한 곳에서 모아 보여줍니다.
          각 시그널은 어느 도메인이 영향 받는지, 무엇을 의미하는지, 다음에 무엇을
          하면 되는지로 정리됩니다. 빨간 시그널부터 처리하세요.
        </p>
        {!orgFound ? (
          <div className="mt-4 note-box">
            이 워크스페이스는 아직 진단이 없습니다. 먼저 진단을 한 번 제출하면 시그널 수집이
            시작됩니다.
          </div>
        ) : null}
      </section>

      {/* SIGNAL SUMMARY — 3가지 톤별 카운트 */}
      {events.length > 0 ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryStat
              label="긴급 (빨강)"
              count={grouped.red.length}
              tone="red"
              active={filter === "red"}
              onClick={() => setFilter(filter === "red" ? "all" : "red")}
            />
            <SummaryStat
              label="주의 (노랑)"
              count={grouped.amber.length}
              tone="amber"
              active={filter === "amber"}
              onClick={() => setFilter(filter === "amber" ? "all" : "amber")}
            />
            <SummaryStat
              label="양호 (초록)"
              count={grouped.green.length}
              tone="green"
              active={filter === "green"}
              onClick={() => setFilter(filter === "green" ? "all" : "green")}
            />
            <SummaryStat
              label="전체"
              count={humanized.length}
              tone="neutral"
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
          </div>
        </section>
      ) : null}

      {/* SIGNAL CARDS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8">
        {filtered.length === 0 ? (
          <div className="border-2 border-ink-soft/40 bg-paper-soft p-8 text-center">
            <p className="kicker mb-2">시그널 없음</p>
            <p className="text-sm text-ink-soft">
              {events.length === 0
                ? "아직 시그널 이벤트가 없습니다. KPI 인입 또는 진단 변동 시 자동 등장합니다."
                : `이 필터(${filter === "red" ? "긴급" : filter === "amber" ? "주의" : "양호"})에 해당하는 시그널이 없습니다.`}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((sig, idx) => (
              <SignalCard
                key={`${idx}-${sig.rawNarrative.slice(0, 40)}`}
                signal={sig}
                showRaw={showRaw}
              />
            ))}
          </ul>
        )}
        {events.length > 0 ? (
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="label-mono hover:text-ink"
            >
              {showRaw ? "원본 narrative 숨기기" : "원본 narrative 보기 (개발자)"}
            </button>
          </div>
        ) : null}
      </section>

      {/* PROACTIVE COACH TRIGGER */}
      {orgFound ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-14">
          <div className="border-2 border-ink p-5 sm:p-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div>
              <p className="kicker mb-1">자동 코칭 사전 진단</p>
              <h3 className="font-display text-xl leading-tight">
                긴급 시그널을 모아 코치가 미리 분석
              </h3>
              <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                production 에서는 15분마다 자동 실행. 로컬·테스트 환경에선 아래 버튼으로 수동 실행.
              </p>
            </div>
            <button
              type="button"
              onClick={runProactive}
              disabled={proactivePending}
              className="btn-primary disabled:opacity-50 shrink-0"
            >
              {proactivePending ? "처리 중…" : "지금 실행"}
              <span className="font-mono text-xs">→</span>
            </button>
          </div>
          {proactiveResult ? (
            <div className="mt-3 note-box font-mono text-xs">
              total_candidates {proactiveResult.total_candidates ?? 0} ·
              already_processed {proactiveResult.already_processed ?? 0} ·
              processed_now {proactiveResult.processed_now ?? 0}
              {proactiveResult.results && proactiveResult.results.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {proactiveResult.results.slice(0, 3).map((r) => (
                    <li key={r.signal_id}>
                      {r.applied ? "✓" : "✗"} #{r.signal_id.slice(0, 8)} →{" "}
                      {r.finding ? r.finding.slice(0, 90) : "—"}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* INJECTOR — dev-only */}
      {showMockInjector ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8">
          <div className="border-2 border-signal-amber bg-soft-amber/20 p-5 sm:p-6">
            <div className="flex items-baseline gap-2 mb-2 flex-wrap">
              <span className="tag tag-gold">개발 전용</span>
              <p className="kicker">샘플 KPI 주입 (mock injector)</p>
            </div>
            <h3 className="font-display text-xl leading-tight">
              외부 KPI 연동 전 파이프라인 검증
            </h3>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              아래 프리셋을 누르면 즉시 KPI snapshot 과 signal event 가 생성됩니다.
              운영 빌드에서는 자동으로 숨김 처리됩니다.
            </p>
            <div className="mt-5 grid grid-cols-2 md:grid-cols-3 gap-3">
              {PRESETS.map((p) => (
                <button
                  key={`${p.source}-${p.metric_key}-${p.value}`}
                  type="button"
                  onClick={() => inject(p)}
                  disabled={pending}
                  className={`border-2 px-3 py-3 text-left hover:bg-paper-deep transition disabled:opacity-50 ${
                    p.severity === "red"
                      ? "border-signal-red"
                      : p.severity === "amber"
                        ? "border-signal-amber"
                        : "border-signal-green"
                  }`}
                >
                  <p className="font-display text-sm leading-tight">{p.label}</p>
                  <p className="mt-1 label-mono">{p.hint}</p>
                </button>
              ))}
            </div>
            {pending ? <p className="mt-4 label-mono">주입 중…</p> : null}
            {lastResult?.ok ? (
              <div className="mt-4 pt-4 border-t border-ink-soft/30">
                <p className="kicker mb-1">최근 주입</p>
                <p className="font-mono text-xs whitespace-pre-wrap">
                  {lastResult.narrative}
                </p>
              </div>
            ) : null}
            {error ? (
              <p className="mt-3 font-mono text-xs text-signal-red">
                <span className="uppercase tracking-widest mr-1">오류</span>{" "}
                {error}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* KPI MAPPING REFERENCE — collapsible */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-14">
        <details className="border-2 border-ink-soft/40 p-5">
          <summary className="cursor-pointer flex items-baseline gap-2 flex-wrap">
            <span className="font-display text-lg">매핑 참조</span>
            <span className="label-mono">
              연동된 KPI 정의 {metricDefs.length}건 · 클릭해서 펼치기
            </span>
          </summary>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            {metricDefs.map((m) => (
              <article
                key={m.id}
                className="border border-ink-soft/40 bg-paper p-3"
              >
                <p className="kicker">{sourceLabel(m.source)}</p>
                <p className="font-mono text-sm mt-1">{m.metric_key}</p>
                <p className="mt-2 label-mono">
                  → {m.mapped_sub_item_code ?? "—"}
                </p>
              </article>
            ))}
          </div>
        </details>
      </section>

      {/* KPI SNAPSHOTS TABLE — collapsible */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-4">
        <details className="border-2 border-ink-soft/40 p-5">
          <summary className="cursor-pointer flex items-baseline gap-2 flex-wrap">
            <span className="font-display text-lg">KPI 스냅샷 로그</span>
            <span className="label-mono">
              원본 측정값 {snapshots.length}건 · 클릭해서 펼치기
            </span>
          </summary>
          {snapshots.length === 0 ? (
            <p className="mt-4 label-mono">아직 스냅샷이 없습니다.</p>
          ) : (
            <div className="mt-5 border border-ink overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper-deep border-b border-ink">
                  <tr className="text-left">
                    <Th>측정 시점</Th>
                    <Th>출처</Th>
                    <Th>지표</Th>
                    <Th>값</Th>
                    <Th>매핑</Th>
                    <Th>상태</Th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => {
                    const subItem = (s.raw as { mapped_sub_item?: string })
                      ?.mapped_sub_item;
                    const bucket = (
                      s.raw as {
                        bucket?: { v: number; severity: string; label: string };
                      }
                    )?.bucket;
                    return (
                      <tr
                        key={s.id}
                        className="border-b border-ink-soft/40 align-top"
                      >
                        <Td className="font-mono text-xs whitespace-nowrap">
                          {formatTime(s.captured_at)}
                        </Td>
                        <Td className="font-mono text-xs">
                          {sourceLabel(s.source)}
                        </Td>
                        <Td className="font-mono text-xs">{s.metric_key}</Td>
                        <Td>{s.value}</Td>
                        <Td className="font-mono text-xs">{subItem ?? "—"}</Td>
                        <Td>
                          {s.anomaly_flag ? (
                            <span className="tag tag-red">빨강</span>
                          ) : bucket?.severity === "amber" ? (
                            <span className="tag tag-gold">주의</span>
                          ) : (
                            <span className="tag tag-green">양호</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a
          href={`/diag/${workspace}/home`}
          className="label-mono hover:text-ink"
        >
          ← 홈으로
        </a>
        <p className="label-mono">{ISSUE_DATE} · signals v2</p>
      </footer>
    </main>
  );
}

// ============================================================
// Sub-components
// ============================================================

function SignalCard({
  signal,
  showRaw,
}: {
  signal: HumanizedSignal;
  showRaw: boolean;
}) {
  const toneClass =
    signal.tone === "red"
      ? "border-signal-red bg-soft-red/20"
      : signal.tone === "amber"
        ? "border-signal-amber bg-soft-amber/20"
        : signal.tone === "green"
          ? "border-signal-green bg-soft-green/15"
          : "border-ink-soft/40 bg-paper-soft";

  const dotClass =
    signal.tone === "red"
      ? "bg-signal-red"
      : signal.tone === "amber"
        ? "bg-signal-amber"
        : signal.tone === "green"
          ? "bg-signal-green"
          : "bg-ink-soft";

  const typeLabel = {
    kpi_update: "KPI 변동",
    session_abandoned: "방치된 코치",
    coach_finding: "코치 진단 도착",
    quarterly_due: "분기 만료",
    other: "기타",
  }[signal.type];

  return (
    <li className={`border-2 ${toneClass} p-5 sm:p-6 transition-colors`}>
      <div className="flex items-start gap-4">
        {/* Dot indicator */}
        <span
          className={`mt-2 w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`}
          aria-hidden="true"
        />

        <div className="flex-1 min-w-0">
          {/* Top meta */}
          <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
            <span
              className={`tag ${
                signal.tone === "red"
                  ? "tag-red"
                  : signal.tone === "amber"
                    ? "tag-gold"
                    : signal.tone === "green"
                      ? "tag-green"
                      : "tag-filled"
              }`}
            >
              {typeLabel}
            </span>
            {signal.metricLine ? (
              <span className="label-mono">{signal.metricLine}</span>
            ) : null}
          </div>

          {/* Headline */}
          <h3 className="font-display text-xl sm:text-2xl leading-tight tracking-tight">
            {signal.headline}
          </h3>

          {/* Body */}
          <p className="mt-2 text-base leading-relaxed text-ink">
            {signal.body}
          </p>

          {/* CTA */}
          {signal.cta ? (
            <div className="mt-4">
              <a
                href={signal.cta.href}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium border-2 transition-colors ${
                  signal.tone === "red"
                    ? "border-signal-red hover:bg-signal-red hover:text-paper"
                    : signal.tone === "amber"
                      ? "border-signal-amber hover:bg-signal-amber hover:text-paper"
                      : "border-ink hover:bg-ink hover:text-paper"
                }`}
              >
                {signal.cta.label}
                <span className="font-mono text-xs">→</span>
              </a>
            </div>
          ) : null}

          {/* Raw narrative (collapsible, dev) */}
          {showRaw ? (
            <details className="mt-4 pt-3 border-t border-ink-soft/30">
              <summary className="cursor-pointer label-mono">
                원본 narrative
              </summary>
              <p className="mt-2 font-mono text-xs text-ink-soft whitespace-pre-wrap leading-relaxed">
                {signal.rawNarrative}
              </p>
            </details>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function SummaryStat({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: "red" | "amber" | "green" | "neutral";
  active: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === "red"
      ? "border-signal-red"
      : tone === "amber"
        ? "border-signal-amber"
        : tone === "green"
          ? "border-signal-green"
          : "border-ink";
  const valueColor =
    tone === "red"
      ? "text-signal-red"
      : tone === "amber"
        ? "text-signal-amber"
        : tone === "green"
          ? "text-signal-green"
          : "text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-2 ${toneClass} p-4 text-left transition-colors ${
        active ? "bg-paper-deep" : "bg-paper hover:bg-paper-deep/50"
      }`}
    >
      <p className="label-mono">{label}</p>
      <p className={`font-display text-3xl mt-1 leading-none ${valueColor}`}>
        {count}
      </p>
      <p className="label-mono mt-1">
        {active ? "필터 해제 ↻" : "필터 보기 →"}
      </p>
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 label-mono font-semibold !text-ink">{children}</th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000; // seconds

  if (diff < 60) return "방금 전";
  if (diff < 60 * 60) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 60 * 60 * 24) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 60 * 60 * 24 * 7) return `${Math.floor(diff / 86400)}일 전`;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

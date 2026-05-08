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
    label: "D1 activation 18%",
    source: "ga4",
    metric_key: "d1_activation_rate",
    value: 0.18,
    hint: "→ A4.ACT.D1 · v=1 RED",
    severity: "red",
  },
  {
    label: "D1 activation 52%",
    source: "ga4",
    metric_key: "d1_activation_rate",
    value: 0.52,
    hint: "→ A4.ACT.D1 · v=4 GREEN",
    severity: "green",
  },
  {
    label: "M3 retention 12%",
    source: "mixpanel",
    metric_key: "m3_retention_rate",
    value: 0.12,
    hint: "→ A2.RET.M3 · v=1 RED (가짜 PMF)",
    severity: "red",
  },
  {
    label: "M3 retention 48%",
    source: "mixpanel",
    metric_key: "m3_retention_rate",
    value: 0.48,
    hint: "→ A2.RET.M3 · v=4 GREEN",
    severity: "green",
  },
  {
    label: "NPS -5",
    source: "channeltalk",
    metric_key: "nps",
    value: -5,
    hint: "→ A13.NPS.SCORE · v=1 RED",
    severity: "red",
  },
  {
    label: "NPS 52",
    source: "channeltalk",
    metric_key: "nps",
    value: 52,
    hint: "→ A13.NPS.SCORE · v=4 GREEN",
    severity: "green",
  },
];

export function SignalsClient({
  workspace,
  orgFound,
  snapshots,
  events,
  metricDefs,
  showMockInjector = false,
}: {
  workspace: string;
  orgFound: boolean;
  snapshots: KpiSnapshot[];
  events: SignalEvent[];
  metricDefs: MetricDefinition[];
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

  return (
    <main className="min-h-dvh w-full pb-20">
      {/* MASTHEAD */}
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <a
              href={`/diag/${workspace}/dashboard`}
              className="kicker hover:text-ink"
            >
              ← Dashboard
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              {workspace} / signals
            </span>
          </div>
          <span className="label-mono">KPI FEED · MOCK</span>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-4">No. 06 · KPI 자동 수집 시그널</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Signal{" "}
          <span className="text-accent italic font-display">Feed</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          Phase 3에서 Stripe·Toss·GA4·ChannelTalk 같은 외부 소스로부터 실시간
          KPI 가 들어오면 <code className="font-mono text-sm">metric_definitions</code>의
          매핑 규칙으로 자동 sub-item 점수에 반영됩니다. 외부 키 셋업 전까지는
          아래 mock injector 로 파이프라인을 검증할 수 있습니다.
        </p>
        {!orgFound ? (
          <div className="mt-4 note-box">
            이 워크스페이스는 아직 organization row가 없습니다 — 먼저 진단을 한 번
            제출해 주세요.
          </div>
        ) : null}
      </section>

      {/* INJECTOR — dev-only */}
      {showMockInjector ? (
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        <div className="area-card !border-signal-amber bg-soft-amber/20">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="tag tag-gold">DEV ONLY</span>
            <p className="kicker">Mock injector</p>
          </div>
          <h2 className="font-display text-2xl">샘플 KPI 주입</h2>
          <p className="mt-2 text-sm text-ink-soft">
            개발·테스트 전용. 8개 프리셋 — 빨강/초록 시나리오를 누르면 즉시
            kpi_snapshots + signal_events에 row가 들어가고 도메인 코치 컨텍스트로
            활용됩니다. 운영 빌드에서는 자동으로 숨김 처리됩니다.
          </p>
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
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
                <p className="mt-1 label-mono text-xs">{p.hint}</p>
              </button>
            ))}
          </div>
          {pending ? (
            <p className="mt-4 label-mono">주입 중…</p>
          ) : null}
          {lastResult?.ok ? (
            <div className="mt-4 dotted-rule pt-4">
              <p className="kicker mb-1">Last inject</p>
              <p className="font-mono text-xs whitespace-pre-wrap">
                {lastResult.narrative}
              </p>
            </div>
          ) : null}
          {error ? (
            <p className="mt-3 font-mono text-xs text-signal-red">⚠ {error}</p>
          ) : null}
        </div>
      </section>
      ) : null}

      {/* PROACTIVE COACH TRIGGER */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        <div className="area-card flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div>
            <p className="kicker mb-1">Proactive coaching cron</p>
            <p className="font-display text-lg">
              high-severity 시그널에 코치가 미리 진단
            </p>
            <p className="mt-1 label-mono">
              production 매 15분 자동. 로컬에선 수동 호출.
            </p>
          </div>
          <button
            type="button"
            onClick={runProactive}
            disabled={proactivePending}
            className="btn-primary disabled:opacity-50"
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

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Signal events ({events.length})
          </span>
        </div>
      </div>

      {/* SIGNAL EVENTS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        {events.length === 0 ? (
          <div className="note-box">
            아직 signal event가 없습니다. 위 mock injector로 시뮬레이션 하세요.
          </div>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => {
              const meta = (ev.metadata ?? {}) as Record<string, unknown>;
              const processedSessionId =
                typeof meta.processed_session_id === "string"
                  ? (meta.processed_session_id as string)
                  : null;
              const findingExcerpt =
                typeof meta.processed_finding_excerpt === "string"
                  ? (meta.processed_finding_excerpt as string)
                  : null;
              return (
                <li
                  key={ev.id}
                  className={`border-l-4 pl-4 py-2 ${
                    ev.severity >= 4
                      ? "border-signal-red"
                      : ev.severity >= 3
                        ? "border-signal-amber"
                        : "border-ink-soft"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <p className="font-mono text-sm">{ev.narrative}</p>
                    <span className="label-mono">
                      {formatTime(ev.created_at)}
                    </span>
                  </div>
                  {ev.domain_code ? (
                    <p className="label-mono mt-0.5">
                      domain {ev.domain_code} · severity {ev.severity}
                    </p>
                  ) : null}
                  {processedSessionId && ev.domain_code ? (
                    <div className="mt-2 ml-1 border-l-2 border-signal-green/60 pl-3 py-1.5 bg-soft-green/30">
                      <a
                        href={`/diag/${workspace}/coach/${ev.domain_code}`}
                        className="kicker !text-signal-green hover:!text-ink"
                      >
                        🤖 Coach finding ready · 클릭해서 보기 →
                      </a>
                      {findingExcerpt ? (
                        <p className="mt-1 font-mono text-xs text-ink">
                          {findingExcerpt}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § KPI snapshots ({snapshots.length})
          </span>
        </div>
      </div>

      {/* KPI SNAPSHOTS TABLE */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        {snapshots.length === 0 ? (
          <div className="note-box">아직 KPI 스냅샷이 없습니다.</div>
        ) : (
          <div className="border border-ink overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-deep border-b border-ink">
                <tr className="text-left">
                  <Th>captured</Th>
                  <Th>source</Th>
                  <Th>metric</Th>
                  <Th>value</Th>
                  <Th>sub-item</Th>
                  <Th>flag</Th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => {
                  const subItem = (s.raw as { mapped_sub_item?: string })?.mapped_sub_item;
                  const bucket = (s.raw as { bucket?: { v: number; severity: string; label: string } })?.bucket;
                  return (
                    <tr key={s.id} className="border-b border-ink-soft/40 align-top">
                      <Td className="font-mono text-xs whitespace-nowrap">
                        {formatTime(s.captured_at)}
                      </Td>
                      <Td className="font-mono text-xs">{s.source}</Td>
                      <Td className="font-mono text-xs">{s.metric_key}</Td>
                      <Td>{s.value}</Td>
                      <Td className="font-mono text-xs">{subItem ?? "—"}</Td>
                      <Td>
                        {s.anomaly_flag ? (
                          <span className="tag tag-red">RED</span>
                        ) : bucket?.severity === "amber" ? (
                          <span className="tag tag-gold">AMBER</span>
                        ) : (
                          <span className="tag tag-green">OK</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MAPPING REFERENCE */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament mb-6">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Configured KPI mappings ({metricDefs.length})
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {metricDefs.map((m) => (
            <article key={m.id} className="metric-card">
              <p className="kicker">{m.source}</p>
              <p className="font-mono text-sm mt-1">{m.metric_key}</p>
              <p className="mt-2 label-mono">→ {m.mapped_sub_item_code ?? "—"}</p>
              {m.threshold_rule ? (
                <pre className="mt-2 font-mono text-[10px] text-ink-soft whitespace-pre-wrap">
                  {JSON.stringify(m.threshold_rule, null, 2)}
                </pre>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a href={`/diag/${workspace}/result`} className="label-mono hover:text-ink">
          ← back to result
        </a>
        <p className="label-mono">{ISSUE_DATE} · signals v1 (mock)</p>
      </footer>
    </main>
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
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

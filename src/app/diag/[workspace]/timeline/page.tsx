import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFramework, type Domain } from "@/lib/framework/loader";
import {
  computeSubItemScore,
  computeGroupScore,
  computeDomainScore,
  computeOverallScore,
  computeFailureProbability,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
  type GroupDef,
  type DomainScoreResult,
} from "@/lib/scoring";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ISSUE_DATE = new Date().toISOString().slice(0, 10);

interface DiagnosisRow {
  id: string;
  workspace_id: string;
  respondent_num: number;
  role: string | null;
  perspective: string | null;
  stage: string | null;
  responses: Record<
    string,
    {
      belief: number;
      evidence: number | null;
      na?: boolean;
      evidence_recorded_at: string;
    }
  > | null;
  completed_at: string;
}

interface QuarterAgg {
  quarter_label: string; // "2026-Q2"
  bucket_start: Date;
  bucket_end: Date;
  n_respondents: number;
  rows: DiagnosisRow[];
  overall: number | null;
  domain_scores: DomainScoreResult[];
  fp_6m: number;
  fp_12m: number;
  red_critical_codes: string[];
}

function quarterLabel(d: Date): string {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

function quarterRange(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  const start = new Date(Date.UTC(y, q * 3, 1));
  const end = new Date(Date.UTC(y, q * 3 + 3, 0, 23, 59, 59));
  return { start, end };
}

export default async function TimelinePage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("diagnosis_responses")
    .select(
      "id, workspace_id, respondent_num, role, perspective, stage, responses, completed_at",
    )
    .eq("workspace_id", workspace)
    .order("completed_at", { ascending: true });

  if (error) {
    return (
      <ErrorView workspace={workspace} message={error.message} />
    );
  }

  const rows = (data ?? []) as DiagnosisRow[];
  if (rows.length === 0) {
    return <EmptyView workspace={workspace} />;
  }

  const framework = loadFramework();
  const aggs = buildQuarterlyAggregates(framework, rows);

  // For sparkline-style mini visualizations
  const allQuarterLabels = aggs.map((a) => a.quarter_label);

  // Compute changes vs previous quarter
  const latest = aggs[aggs.length - 1];
  const prev = aggs.length > 1 ? aggs[aggs.length - 2] : null;
  const overallDelta =
    latest && prev && latest.overall !== null && prev.overall !== null
      ? latest.overall - prev.overall
      : null;
  const fpDelta = latest && prev ? latest.fp_6m - prev.fp_6m : null;

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
              {workspace} / timeline
            </span>
          </div>
          <span className="label-mono">QUARTERLY TIMELINE</span>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-4">No. 08 · 분기 추이</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Time{" "}
          <span className="text-accent italic font-display">Series</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          {aggs.length}분기에 걸쳐 14-도메인 점수와 실패 확률이 어떻게 변했는지
          추적합니다. 각 분기는 해당 분기 내 모든 응답자의 합산입니다.
          분기 횟수가 많을수록 운영 OS의 효과가 정량으로 드러납니다.
        </p>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className="tag tag-filled">총 {rows.length}건 응답</span>
          <span className="tag">분기 {aggs.length}개</span>
          {latest ? (
            <span className="tag">최신 {latest.quarter_label}</span>
          ) : null}
        </div>
      </section>

      {/* SUMMARY METRICS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric
          label="Overall (latest)"
          value={
            latest?.overall === null || latest?.overall === undefined
              ? "—"
              : Math.round(latest.overall).toString()
          }
          sub={
            overallDelta === null
              ? "단일 분기"
              : `Δ ${overallDelta >= 0 ? "+" : ""}${overallDelta.toFixed(1)}`
          }
          tone={
            overallDelta === null
              ? undefined
              : overallDelta >= 5
                ? "green"
                : overallDelta <= -5
                  ? "red"
                  : "amber"
          }
        />
        <Metric
          label="P(fail, 6m)"
          value={`${Math.round((latest?.fp_6m ?? 0) * 100)}%`}
          sub={
            fpDelta === null
              ? "단일 분기"
              : `Δ ${fpDelta >= 0 ? "+" : ""}${(fpDelta * 100).toFixed(1)}pp`
          }
          tone={
            fpDelta === null
              ? undefined
              : fpDelta <= -0.05
                ? "green"
                : fpDelta >= 0.05
                  ? "red"
                  : "amber"
          }
        />
        <Metric
          label="Red critical (latest)"
          value={String(latest?.red_critical_codes.length ?? 0)}
          sub={latest?.red_critical_codes.join(", ") || "없음"}
          tone={
            (latest?.red_critical_codes.length ?? 0) === 0
              ? "green"
              : (latest?.red_critical_codes.length ?? 0) >= 2
                ? "red"
                : "amber"
          }
        />
        <Metric
          label="Quarters tracked"
          value={String(aggs.length)}
          sub={
            aggs.length === 1
              ? "최소 2분기 후 추세 가시화"
              : `${allQuarterLabels[0]} → ${allQuarterLabels[allQuarterLabels.length - 1]}`
          }
        />
      </section>

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Domain heatmap (quarter × score)
          </span>
        </div>
      </div>

      {/* HEATMAP */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 overflow-x-auto">
        <table className="w-full text-sm border border-ink">
          <thead className="bg-paper-deep border-b border-ink">
            <tr className="text-left">
              <Th className="!w-48">Domain</Th>
              {aggs.map((a) => (
                <Th key={a.quarter_label} className="text-center">
                  <div className="font-display text-base">
                    {a.quarter_label}
                  </div>
                  <div className="label-mono">n={a.n_respondents}</div>
                </Th>
              ))}
              <Th className="text-center">Trend</Th>
            </tr>
          </thead>
          <tbody>
            {framework.domains.map((d) => {
              const series = aggs.map((a) => {
                const ds = a.domain_scores.find((x) => x.domain === d.code);
                return ds?.score ?? null;
              });
              return (
                <tr
                  key={d.code}
                  className="border-b border-ink-soft/30 align-middle"
                >
                  <Td className="font-mono text-xs">
                    <div className="flex items-baseline gap-2">
                      <span>{d.code}</span>
                      <span className="font-display text-sm text-ink">
                        {d.name_ko}
                      </span>
                    </div>
                    <span
                      className={`tag mt-1 inline-block ${
                        d.tier === "critical"
                          ? "tag-accent"
                          : d.tier === "important"
                            ? "tag-gold"
                            : ""
                      }`}
                    >
                      {d.tier.toUpperCase()}
                    </span>
                  </Td>
                  {series.map((score, i) => (
                    <Td
                      key={i}
                      className={`text-center ${cellBg(score, d)}`}
                    >
                      <span className="font-display text-lg">
                        {score === null ? "—" : Math.round(score)}
                      </span>
                    </Td>
                  ))}
                  <Td className="text-center">
                    <Sparkline values={series} domain={d} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Failure probability trend
          </span>
        </div>
      </div>

      {/* FAILURE PROBABILITY TREND */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
        <div className="area-card">
          <p className="kicker mb-2">P(fail) over time</p>
          <FpTrend aggs={aggs} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            {aggs.slice(-2).map((a) => (
              <div key={a.quarter_label} className="metric-card">
                <p className="kicker">{a.quarter_label}</p>
                <p className="font-mono text-xs mt-1">
                  P(6m) {Math.round(a.fp_6m * 100)}% · P(12m){" "}
                  {Math.round(a.fp_12m * 100)}%
                </p>
                {a.red_critical_codes.length > 0 ? (
                  <p className="label-mono mt-1 !text-signal-red">
                    red: {a.red_critical_codes.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Quarters log
          </span>
        </div>
      </div>

      {/* QUARTERS LOG */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {aggs.map((a) => (
          <article key={a.quarter_label} className="metric-card">
            <p className="kicker">{a.quarter_label}</p>
            <p className="font-mono text-xs mt-1">
              {a.bucket_start.toISOString().slice(0, 10)} →{" "}
              {a.bucket_end.toISOString().slice(0, 10)}
            </p>
            <p className="num mt-2">
              {a.overall === null ? "—" : Math.round(a.overall)}
            </p>
            <p className="label-mono">
              {a.n_respondents}명 응답 · P(6m){" "}
              {Math.round(a.fp_6m * 100)}%
            </p>
          </article>
        ))}
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a href={`/diag/${workspace}/result`} className="label-mono hover:text-ink">
          ← back to result
        </a>
        <p className="label-mono">{ISSUE_DATE} · timeline v1</p>
      </footer>
    </main>
  );
}

// ============================================================
// Aggregation
// ============================================================

function buildQuarterlyAggregates(
  framework: ReturnType<typeof loadFramework>,
  rows: DiagnosisRow[],
): QuarterAgg[] {
  // 1. Bucket rows by quarter_label
  const byQuarter = new Map<string, DiagnosisRow[]>();
  for (const r of rows) {
    const d = new Date(r.completed_at);
    const lbl = quarterLabel(d);
    const arr = byQuarter.get(lbl) ?? [];
    arr.push(r);
    byQuarter.set(lbl, arr);
  }

  // 2. Sort labels chronologically
  const labels = Array.from(byQuarter.keys()).sort();

  return labels.map((lbl) => {
    const grpRows = byQuarter.get(lbl)!;
    const firstDate = new Date(grpRows[0].completed_at);
    const range = quarterRange(firstDate);
    const agg = aggregateRespondents(framework, grpRows);
    return {
      quarter_label: lbl,
      bucket_start: range.start,
      bucket_end: range.end,
      n_respondents: grpRows.length,
      rows: grpRows,
      overall: agg.overall,
      domain_scores: agg.domain_scores,
      fp_6m: agg.fp_6m,
      fp_12m: agg.fp_12m,
      red_critical_codes: agg.red_critical_codes,
    };
  });
}

function aggregateRespondents(
  framework: ReturnType<typeof loadFramework>,
  rows: DiagnosisRow[],
) {
  const subDefs: SubItemDef[] = framework.domains.flatMap((d) =>
    d.groups.flatMap((g) =>
      g.sub_items.map((s) => ({
        code: s.code,
        domain: s.domain,
        group: s.group,
        tier: s.tier,
        weight_within_group: s.weight_within_group,
        data_quality_required: (s.data_quality_required ?? 1) as 1 | 2 | 3,
        reverse_scoring: s.reverse_scoring,
      })),
    ),
  );
  const subDefMap = new Map(subDefs.map((s) => [s.code, s]));

  const responses: SubItemResponse[] = [];
  for (const row of rows) {
    if (!row.responses) continue;
    for (const [code, r] of Object.entries(row.responses)) {
      if (!subDefMap.has(code)) continue;
      if (!r.belief) continue;
      responses.push({
        sub_item_code: code,
        respondent_id: `r${row.respondent_num}`,
        belief: r.belief as 1 | 2 | 3 | 4 | 5,
        evidence:
          r.na || r.evidence === null || r.evidence === undefined
            ? null
            : (r.evidence as 1 | 2 | 3 | 4 | 5),
        evidence_recorded_at: new Date(r.evidence_recorded_at),
      });
    }
  }

  const groupDefs: GroupDef[] = framework.domains.flatMap((d) => {
    const cnt = d.groups.length || 1;
    return d.groups.map((g) => ({
      code: g.code,
      domain: d.code,
      weight_within_domain: 1 / cnt,
      is_critical: g.sub_items.some((s) => s.tier === "critical"),
    }));
  });

  // Per-respondent sub-item scores → average per sub-item
  const subScoresPerRespondent = new Map<
    string,
    Map<string, ReturnType<typeof computeSubItemScore>>
  >();
  const now = new Date();
  for (const r of responses) {
    const def = subDefMap.get(r.sub_item_code);
    if (!def) continue;
    const score = computeSubItemScore(r, def, now);
    if (!subScoresPerRespondent.has(r.respondent_id)) {
      subScoresPerRespondent.set(r.respondent_id, new Map());
    }
    subScoresPerRespondent.get(r.respondent_id)!.set(r.sub_item_code, score);
  }

  const subScoreAvg = new Map<
    string,
    ReturnType<typeof computeSubItemScore>
  >();
  for (const def of subDefs) {
    const scores: number[] = [];
    for (const map of subScoresPerRespondent.values()) {
      const r = map.get(def.code);
      if (r && r.score !== null) scores.push(r.score);
    }
    if (scores.length === 0) continue;
    const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
    subScoreAvg.set(def.code, {
      score: mean,
      penalty: 0,
      belief_normalized: 0,
      evidence_normalized: null,
    });
  }

  const subDefsByGroup = new Map<string, SubItemDef[]>();
  for (const s of subDefs) {
    const list = subDefsByGroup.get(s.group);
    if (list) list.push(s);
    else subDefsByGroup.set(s.group, [s]);
  }

  const groupScoreMap = new Map<
    string,
    ReturnType<typeof computeGroupScore>
  >();
  for (const [code, defs] of subDefsByGroup.entries()) {
    const groupDef = groupDefs.find((g) => g.code === code);
    if (!groupDef) continue;
    groupScoreMap.set(code, computeGroupScore(groupDef, defs, subScoreAvg));
  }

  const domainDefs = framework.domains.map((d) => ({
    code: d.code,
    weight: d.weight,
    tier: d.tier,
  }));

  const domain_scores = framework.domains.map((d) => {
    const responded = new Set(responses.map((r) => r.sub_item_code));
    const missingPenalty =
      d.groups
        .flatMap((g) => g.sub_items)
        .filter(
          (s) =>
            !responded.has(s.code) && (s.data_quality_required ?? 1) >= 2,
        ).length * -8;
    return computeDomainScore(
      { code: d.code, weight: d.weight, tier: d.tier },
      groupDefs.filter((g) => g.domain === d.code),
      groupScoreMap,
      missingPenalty,
      d.thresholds,
    );
  });

  const overall = computeOverallScore(domain_scores, domainDefs);
  const stage = (rows[rows.length - 1]?.stage as Stage) ?? "seed";
  const fp = computeFailureProbability(
    domain_scores,
    domainDefs,
    responses,
    stage,
  );

  const red_critical_codes = domain_scores
    .filter((d) => {
      const def = framework.domains.find((x) => x.code === d.domain);
      return (
        def?.tier === "critical" &&
        d.score !== null &&
        d.score < def.thresholds.red
      );
    })
    .map((d) => d.domain);

  return {
    overall,
    domain_scores,
    fp_6m: fp["6m"].final,
    fp_12m: fp["12m"].final,
    red_critical_codes,
  };
}

// ============================================================
// UI helpers
// ============================================================

function cellBg(score: number | null, domain: Domain): string {
  if (score === null) return "bg-paper-soft";
  if (score >= domain.thresholds.green) return "bg-soft-green";
  if (score >= domain.thresholds.yellow) return "bg-soft-amber";
  if (score >= domain.thresholds.red) return "bg-soft-amber";
  return "bg-soft-red";
}

function Sparkline({
  values,
  domain,
}: {
  values: (number | null)[];
  domain: Domain;
}) {
  if (values.length < 2) {
    return <span className="label-mono">single quarter</span>;
  }
  const cleaned = values.map((v) => v ?? 0);
  const min = Math.min(...cleaned, domain.thresholds.red);
  const max = Math.max(...cleaned, 100);
  const range = Math.max(1, max - min);
  const w = 80;
  const h = 24;
  const points = cleaned.map((v, i) => {
    const x = (i / (cleaned.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = points.join(" ");
  const last = cleaned[cleaned.length - 1];
  const prev = cleaned[cleaned.length - 2];
  const delta = last - prev;
  const stroke =
    delta >= 5
      ? "stroke-signal-green"
      : delta <= -5
        ? "stroke-signal-red"
        : "stroke-ink-soft";
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="overflow-visible"
      >
        <polyline
          points={polyline}
          className={stroke}
          fill="none"
          strokeWidth={1.5}
        />
        <circle
          cx={w}
          cy={h - ((last - min) / range) * h}
          r={2}
          className={`${stroke.replace("stroke-", "fill-")}`}
        />
      </svg>
      <span
        className={`font-mono text-xs ${
          delta >= 5
            ? "text-signal-green"
            : delta <= -5
              ? "text-signal-red"
              : "text-ink-soft"
        }`}
      >
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(0)}
      </span>
    </span>
  );
}

function FpTrend({ aggs }: { aggs: QuarterAgg[] }) {
  if (aggs.length < 2) {
    return (
      <p className="label-mono mt-2">
        실패 확률 추세는 최소 2분기 응답 후 표시됩니다.
      </p>
    );
  }
  const w = 720;
  const h = 120;
  const xs = aggs.map((_, i) => (i / (aggs.length - 1)) * w);
  const yScale = (v: number) => h - v * h; // 0..1 → bottom..top
  const sixPath = aggs.map((a, i) => `${xs[i]},${yScale(a.fp_6m).toFixed(1)}`);
  const twelvePath = aggs.map(
    (a, i) => `${xs[i]},${yScale(a.fp_12m).toFixed(1)}`,
  );

  return (
    <div className="mt-3 overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h + 20}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={0}
            x2={w}
            y1={yScale(g)}
            y2={yScale(g)}
            className="stroke-ink-soft/20"
            strokeDasharray="3 3"
          />
        ))}
        <polyline
          points={twelvePath.join(" ")}
          className="stroke-signal-amber"
          fill="none"
          strokeWidth={2}
        />
        <polyline
          points={sixPath.join(" ")}
          className="stroke-signal-red"
          fill="none"
          strokeWidth={2}
        />
        {aggs.map((a, i) => (
          <g key={a.quarter_label}>
            <circle
              cx={xs[i]}
              cy={yScale(a.fp_6m)}
              r={3}
              className="fill-signal-red"
            />
            <circle
              cx={xs[i]}
              cy={yScale(a.fp_12m)}
              r={3}
              className="fill-signal-amber"
            />
            <text
              x={xs[i]}
              y={h + 14}
              className="fill-ink-soft font-mono text-[9px]"
              textAnchor="middle"
            >
              {a.quarter_label}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex gap-4 mt-2 label-mono">
        <span>
          <span className="inline-block w-3 h-1 align-middle bg-signal-red" />{" "}
          P(fail, 6m)
        </span>
        <span>
          <span className="inline-block w-3 h-1 align-middle bg-signal-amber" />{" "}
          P(fail, 12m)
        </span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red";
}) {
  const color =
    tone === "green"
      ? "text-signal-green"
      : tone === "amber"
        ? "text-signal-amber"
        : tone === "red"
          ? "text-signal-red"
          : "text-ink";
  return (
    <div className="metric-card">
      <p className="label-mono">{label}</p>
      <p className={`num mt-1 ${color}`}>{value}</p>
      {sub ? <p className="mt-1 label-mono">{sub}</p> : null}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-3 py-3 label-mono font-semibold !text-ink ${className}`}>
      {children}
    </th>
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

function EmptyView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">No diagnosis history</p>
        <h1 className="font-display text-3xl">
          이 워크스페이스에 진단 기록이 없습니다
        </h1>
        <a
          href={`/diag/${workspace}`}
          className="btn-primary mt-6 inline-flex"
        >
          진단 시작 <span className="font-mono text-xs">→</span>
        </a>
      </div>
    </main>
  );
}

function ErrorView({
  workspace,
  message,
}: {
  workspace: string;
  message: string;
}) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md">
        <p className="kicker mb-2 !text-signal-red">Error</p>
        <pre className="font-mono text-xs whitespace-pre-wrap">{message}</pre>
        <a
          href={`/diag/${workspace}/result`}
          className="btn-secondary mt-6 inline-flex"
        >
          ← back to result
        </a>
      </div>
    </main>
  );
}

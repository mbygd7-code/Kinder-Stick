import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFramework, type Domain } from "@/lib/framework/loader";
import {
  computeSubItemScore,
  computeGroupScore,
  computeDomainScore,
  computeOverallScore,
  computeFailureProbability,
  computeConsensus,
  type Stage,
  type SubItemDef,
  type SubItemResponse,
  type GroupDef,
  type DomainDef,
  type DomainScoreResult,
} from "@/lib/scoring";

interface Props {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ session?: string; respondent?: string }>;
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
  result: Record<string, unknown> | null;
  completed_at: string;
}

export default async function ResultPage({ params, searchParams }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();
  const sp = await searchParams;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("diagnosis_responses")
    .select(
      "id, workspace_id, respondent_num, role, perspective, stage, responses, result, completed_at",
    )
    .eq("workspace_id", workspace)
    .order("respondent_num", { ascending: true });

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
  const aggregate = aggregateRespondents(framework, rows);

  // Quarterly diagnosis check — surface a banner if the latest response is > 90d old
  const latestRow = rows[rows.length - 1];
  const latestDate = new Date(latestRow.completed_at);
  const daysSinceLatest = Math.floor(
    (Date.now() - latestDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  const quarterlyDue = daysSinceLatest >= 90;

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
              workspace · {workspace}
            </span>
          </div>
          <span className="label-mono">RESULT / SUMMARY</span>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-4">No. 05 · 진단 결과</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Reality{" "}
          <span className="text-accent italic font-display">Report</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          {rows.length}명의 응답을 합산해 14-도메인 점수와 6/12개월 실패확률을
          산출했습니다. 빨간 도메인이 있다면 다음 단계는 해당 도메인 AI 코치
          소환입니다 (다음 phase에서 wiring).
        </p>
        {sp.respondent ? (
          <p className="mt-3 label-mono">
            방금 제출한 응답은 #{sp.respondent}번입니다.
          </p>
        ) : null}
      </section>

      {/* QUARTERLY DUE BANNER */}
      {quarterlyDue ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
          <div className="area-card !border-signal-amber bg-soft-amber/40">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="kicker mb-1 !text-signal-amber">
                  Quarterly review · {daysSinceLatest}d 경과
                </p>
                <h2 className="font-display text-2xl">
                  분기 진단 시점 — 재응답을 권장합니다
                </h2>
                <p className="mt-2 text-sm text-ink-soft">
                  마지막 응답일 {latestDate.toISOString().slice(0, 10)}.
                  90일 이상 경과하면 KPI/팀/시장 변동이 점수에 반영되지 않아
                  코치 정확도가 떨어집니다.
                </p>
              </div>
              <a href={`/diag/${workspace}`} className="btn-primary">
                재진단 시작
                <span className="font-mono text-xs">→</span>
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {/* HEADLINE METRICS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric
          label="Overall"
          value={
            aggregate.overall === null
              ? "—"
              : Math.round(aggregate.overall).toString()
          }
          sub="0–100"
          tone={
            aggregate.overall === null
              ? undefined
              : aggregate.overall >= 60
                ? "green"
                : aggregate.overall >= 40
                  ? "amber"
                  : "red"
          }
        />
        <Metric
          label="P(fail, 6m)"
          value={`${Math.round(aggregate.fp["6m"].final * 100)}%`}
          sub={`prior ${Math.round(aggregate.fp["6m"].prior * 100)}%`}
          tone={
            aggregate.fp["6m"].final < 0.25
              ? "green"
              : aggregate.fp["6m"].final < 0.45
                ? "amber"
                : "red"
          }
        />
        <Metric
          label="P(fail, 12m)"
          value={`${Math.round(aggregate.fp["12m"].final * 100)}%`}
          sub={`prior ${Math.round(aggregate.fp["12m"].prior * 100)}%`}
          tone={
            aggregate.fp["12m"].final < 0.35
              ? "green"
              : aggregate.fp["12m"].final < 0.55
                ? "amber"
                : "red"
          }
        />
        <Metric
          label="Respondents"
          value={String(rows.length)}
          sub={`stage · ${aggregate.stage}`}
        />
      </section>

      {/* RED CRITICAL DOMAINS BANNER */}
      {aggregate.fp["6m"].red_critical_domains.length > 0 ||
      aggregate.fp["6m"].triggered_caps.length > 0 ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8">
          <div className="area-card !border-signal-red bg-soft-red/40">
            <p className="kicker mb-2 !text-signal-red">! Red flags</p>
            <h2 className="font-display text-2xl">
              빨간 critical 도메인 ·{" "}
              {aggregate.fp["6m"].red_critical_domains.length}개
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {aggregate.fp["6m"].red_critical_domains.map((code) => {
                const d = framework.domains.find((x) => x.code === code);
                return (
                  <li
                    key={code}
                    className="tag tag-red"
                  >{`${code} · ${d?.name_ko ?? ""}`}</li>
                );
              })}
            </ul>
            {aggregate.fp["6m"].triggered_caps.length > 0 ? (
              <p className="mt-3 label-mono">
                triggered caps: {aggregate.fp["6m"].triggered_caps.join(", ")}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Domain breakdown
          </span>
        </div>
      </div>

      {/* DOMAIN BARS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 space-y-3">
        {framework.domains.map((d) => {
          const ds = aggregate.domain_scores.find((x) => x.domain === d.code);
          return (
            <DomainBar
              key={d.code}
              domain={d}
              result={ds}
              workspace={workspace}
            />
          );
        })}
      </section>

      {/* RESPONDENTS LIST */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament mb-6">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Respondents · {rows.length}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map((r) => (
            <article key={r.id} className="metric-card">
              <p className="kicker">
                <span className="section-num">No. </span>
                {r.respondent_num}
              </p>
              <p className="font-display text-xl mt-1 leading-tight">
                {r.role || "익명 응답자"}
              </p>
              <p className="label-mono">
                {r.perspective ?? "-"} · {r.stage ?? "-"} ·{" "}
                {Object.keys(r.responses ?? {}).length}개 응답
              </p>
              <p className="label-mono mt-1">
                {formatTime(r.completed_at)}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* NEXT STEP */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-14">
        <div className="area-card">
          <p className="kicker mb-2">Phase 2 · AI Coaching MVP</p>
          <h2 className="font-display text-3xl">다음 단계 — AI 도메인 코치</h2>
          <p className="mt-3 text-ink-soft leading-relaxed">
            결손 도메인이 감지되면 해당 도메인 AI 코치(예: PMF Coach, CFO/IR
            Agent)가 활성화되어 진단 질문 → 증거 요청 → SMART 3단계 액션을
            제안합니다. 다음 작업에서 PMF·Unit Eco·Team 3개 도메인부터 코칭
            루프를 wiring합니다.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/diag/${workspace}/actions`}
              className="btn-primary"
            >
              Action board
              <span className="font-mono text-xs">→</span>
            </a>
            <a
              href={`/diag/${workspace}/timeline`}
              className="btn-secondary"
            >
              Timeline
              <span className="font-mono text-xs">→</span>
            </a>
            <a
              href={`/diag/${workspace}/signals`}
              className="btn-secondary"
            >
              KPI Signal feed
              <span className="font-mono text-xs">→</span>
            </a>
            <a href={`/diag/${workspace}`} className="btn-secondary">
              <span className="font-mono text-xs">←</span>
              다시 응답하기
            </a>
            <a href="/diag" className="btn-secondary">
              <span className="font-mono text-xs">←</span>
              Domain Map
            </a>
          </div>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">
          aggregated across {rows.length} respondents
        </p>
        <p className="label-mono">{ISSUE_DATE} · result v1</p>
      </footer>
    </main>
  );
}

// ============================================================
// Aggregation
// ============================================================

interface AggregateResult {
  overall: number | null;
  domain_scores: DomainScoreResult[];
  fp: ReturnType<typeof computeFailureProbability>;
  stage: Stage;
}

function aggregateRespondents(
  framework: ReturnType<typeof loadFramework>,
  rows: DiagnosisRow[],
): AggregateResult {
  // 모든 응답자의 sub-item 응답을 합쳐 SubItemResponse[]로 변환
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

  const now = new Date();
  const subScoresPerRespondent = new Map<
    string,
    Map<string, ReturnType<typeof computeSubItemScore>>
  >();

  for (const r of responses) {
    const def = subDefMap.get(r.sub_item_code);
    if (!def) continue;
    const score = computeSubItemScore(r, def, now);
    if (!subScoresPerRespondent.has(r.respondent_id)) {
      subScoresPerRespondent.set(r.respondent_id, new Map());
    }
    subScoresPerRespondent.get(r.respondent_id)!.set(r.sub_item_code, score);
  }

  // Per-sub-item average (consensus aware)
  const subScoreAvg = new Map<
    string,
    ReturnType<typeof computeSubItemScore>
  >();
  for (const def of subDefs) {
    const scores: number[] = [];
    let representativeFlag: ReturnType<
      typeof computeSubItemScore
    >["flag"];
    for (const map of subScoresPerRespondent.values()) {
      const r = map.get(def.code);
      if (!r) continue;
      if (r.score !== null) scores.push(r.score);
      if (r.flag) representativeFlag = r.flag;
    }
    if (scores.length === 0) continue;
    const consensus = computeConsensus(scores);
    subScoreAvg.set(def.code, {
      score: consensus?.reported_score ?? null,
      penalty: 0,
      flag: representativeFlag,
      belief_normalized: 0,
      evidence_normalized: null,
    });
  }

  // Group + Domain
  const groupDefs: GroupDef[] = framework.domains.flatMap((d) => {
    const cnt = d.groups.length || 1;
    return d.groups.map((g) => ({
      code: g.code,
      domain: d.code,
      weight_within_domain: 1 / cnt,
      is_critical: g.sub_items.some((s) => s.tier === "critical"),
    }));
  });
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

  const domainScores = framework.domains.map((d) => {
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

  const overall = computeOverallScore(
    domainScores,
    framework.domains.map((d) => ({
      code: d.code,
      weight: d.weight,
      tier: d.tier,
    })),
  );

  // Stage: 가장 흔한 stage (혹은 최신 응답자)
  const stage = (rows[rows.length - 1]?.stage as Stage) ?? "seed";

  const fp = computeFailureProbability(
    domainScores,
    framework.domains.map((d) => ({
      code: d.code,
      weight: d.weight,
      tier: d.tier,
    })),
    responses,
    stage,
  );

  return { overall, domain_scores: domainScores, fp, stage };
}

// ============================================================
// Sub-components
// ============================================================

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

function DomainBar({
  domain,
  result,
  workspace,
}: {
  domain: Domain;
  result?: DomainScoreResult;
  workspace: string;
}) {
  const score = result?.score;
  const tone =
    score === null || score === undefined
      ? "red"
      : score >= domain.thresholds.green
        ? "green"
        : score >= domain.thresholds.yellow
          ? "amber"
          : score >= domain.thresholds.red
            ? "amber"
            : "red";
  const fillClass =
    tone === "green" ? "green" : tone === "amber" ? "amber" : "red";
  const pct = score === null || score === undefined ? 0 : Math.max(2, score);

  return (
    <a
      href={`/diag/${workspace}/coach/${domain.code}`}
      className="block transition-colors hover:bg-paper-deep/40 rounded-sm group -mx-2 px-2 py-1.5"
      title={`${domain.code} ${domain.name_ko} — AI 코치와 대화`}
    >
      <article className="grid grid-cols-[100px_1fr_60px_24px] sm:grid-cols-[120px_1fr_80px_28px] items-center gap-3">
        <div className="text-right">
          <span className="font-mono text-xs">{domain.code}</span>
          <p className="font-display text-sm leading-tight">{domain.name_ko}</p>
        </div>
        <div>
          <div className="bar-track bar-bg-pattern">
            <div
              className={`bar-fill ${fillClass}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-soft">
            <span>0</span>
            <span>{domain.thresholds.red}</span>
            <span>{domain.thresholds.yellow}</span>
            <span>{domain.thresholds.green}</span>
            <span>100</span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl leading-none">
            {score === null || score === undefined ? "—" : Math.round(score)}
          </p>
          {result?.capped ? (
            <p className="label-mono !text-signal-red">capped</p>
          ) : null}
        </div>
        <span
          className="font-mono text-base text-ink-soft group-hover:text-accent transition-colors"
          aria-hidden
        >
          →
        </span>
      </article>
    </a>
  );
}

function EmptyView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">No data</p>
        <h1 className="font-display text-3xl leading-tight">
          이 워크스페이스에는 아직 응답이 없습니다
        </h1>
        <p className="mt-3 text-ink-soft">
          <span className="font-mono">{workspace}</span> 로 진단을 시작하세요.
        </p>
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
        <h1 className="font-display text-3xl leading-tight">
          결과를 불러오지 못했습니다
        </h1>
        <pre className="mt-3 font-mono text-xs whitespace-pre-wrap">
          {message}
        </pre>
        <a
          href={`/diag/${workspace}`}
          className="btn-secondary mt-6 inline-flex"
        >
          ← 진단 폼으로
        </a>
      </div>
    </main>
  );
}

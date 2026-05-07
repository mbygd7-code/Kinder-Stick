import { runScoringTests, summarize } from "@/lib/scoring.test-cases";

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

export default function ScoringTestPage() {
  const results = runScoringTests();
  const summary = summarize(results);
  const allPass = summary.failed === 0;

  return (
    <main className="min-h-dvh w-full">
      {/* MASTHEAD */}
      <header className="border-b-2 border-ink">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <a href="/" className="kicker hover:text-ink">
              ← Kinder Stick OS
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">{ISSUE_DATE}</span>
          </div>
          <span className="label-mono">SCORING ENGINE</span>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-14 pb-8">
        <p className="kicker mb-4">No. 02 · 단위 테스트</p>
        <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] tracking-tight">
          Bayesian Scoring{" "}
          <span className="text-accent">Engine</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
          framework/scoring.md 명세대로 구현한 점수 산식이{" "}
          <strong className="font-semibold text-ink">{summary.total}개 테스트 시드</strong>
          를 통과하는지 검증합니다. Belief–Evidence 망상 페널티, Time decay,
          Critical cap, Consensus σ, Failure Probability 베이지안 업데이트.
        </p>

        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <span className="tag tag-filled">Phase 0</span>
          <span className="tag">Pure Function · No DB</span>
          <span className={`tag ${allPass ? "tag-green" : "tag-red"}`}>
            {summary.passed} / {summary.total} PASS
          </span>
        </div>
      </section>

      {/* DIVIDER */}
      <div className="max-w-5xl mx-auto px-6 sm:px-10">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Test Results
          </span>
        </div>
      </div>

      {/* SUMMARY */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total" value={summary.total.toString()} />
        <SummaryCard
          label="Passed"
          value={summary.passed.toString()}
          tone={allPass ? "green" : "neutral"}
        />
        <SummaryCard
          label="Failed"
          value={summary.failed.toString()}
          tone={summary.failed > 0 ? "red" : "neutral"}
        />
        <SummaryCard
          label="Coverage"
          value={`${Math.round((summary.passed / summary.total) * 100)}%`}
        />
      </section>

      {/* RESULTS BY CATEGORY */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-10 space-y-10">
        {Object.entries(summary.by_category).map(([cat, agg]) => (
          <div key={cat}>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-display text-2xl">
                <span className="kicker section-num mr-2">§</span>
                {categoryLabel(cat)}
              </h2>
              <span className="label-mono">
                {agg.passed} / {agg.total}
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {results
                .filter((r) => r.category === cat)
                .map((r) => (
                  <article
                    key={r.id}
                    className={`area-card ${
                      r.pass ? "" : "!border-signal-red bg-soft-red/30"
                    }`}
                  >
                    <header className="flex items-baseline justify-between gap-4">
                      <span className="kicker">
                        <span className="section-num">No. </span>
                        {r.id}
                      </span>
                      <span
                        className={`tag ${r.pass ? "tag-green" : "tag-red"}`}
                      >
                        {r.pass ? "PASS" : "FAIL"}
                      </span>
                    </header>
                    <h3 className="mt-3 font-display text-lg leading-tight">
                      {r.name}
                    </h3>
                    <dl className="mt-3 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-sm">
                      <dt className="label-mono">expected</dt>
                      <dd className="font-mono text-ink-soft break-words">
                        {r.expected}
                      </dd>
                      <dt className="label-mono">actual</dt>
                      <dd
                        className={`font-mono break-words ${
                          r.pass ? "text-ink" : "text-accent-deep font-semibold"
                        }`}
                      >
                        {r.actual}
                      </dd>
                    </dl>
                  </article>
                ))}
            </div>
          </div>
        ))}
      </section>

      {/* NOTE BOX */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-12">
        <div className="note-box">
          <strong className="text-ink">계산 검증 메모.</strong> 이 페이지는{" "}
          <code className="font-mono text-xs">src/lib/scoring.test-cases.ts</code>
          를 서버 사이드에서 즉석 실행해 결과를 보여줍니다. 후속 작업에서
          Vitest로 옮기면서 동일한 케이스를 CI에 묶습니다. 수치 검증 로직과
          기대값은 framework/scoring.md §단위 테스트 표를 그대로 따릅니다.
        </div>
      </section>

      {/* FOOTER */}
      <footer className="max-w-5xl mx-auto px-6 sm:px-10 mt-20 pb-12 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a href="/" className="label-mono hover:text-ink">
          ← back to smoke test
        </a>
        <p className="label-mono">{ISSUE_DATE} · scoring engine v1.0</p>
      </footer>
    </main>
  );
}

function categoryLabel(c: string): string {
  switch (c) {
    case "sub_item":
      return "Sub-item Score";
    case "consensus":
      return "Team Consensus";
    case "failure_prob":
      return "Failure Probability";
    default:
      return c;
  }
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "red" | "neutral";
}) {
  const valueColor =
    tone === "green"
      ? "text-signal-green"
      : tone === "red"
        ? "text-signal-red"
        : "text-ink";
  return (
    <div className="metric-card">
      <p className="label-mono">{label}</p>
      <p className={`num mt-1 ${valueColor}`}>{value}</p>
    </div>
  );
}

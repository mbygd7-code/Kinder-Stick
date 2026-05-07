import {
  loadFramework,
  countByTier,
  type Domain,
  type Tier,
} from "@/lib/framework/loader";
import StartDiagnosisForm from "./_start-form";
import { getCurrentUser } from "@/lib/supabase/auth";

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

export default async function DiagLandingPage() {
  const framework = loadFramework();
  const currentUser = await getCurrentUser();
  const totalSubItems = framework.domains
    .flatMap((d) => d.groups.flatMap((g) => g.sub_items))
    .length;
  const totalGroups = framework.domains.flatMap((d) => d.groups).length;
  const tierCounts = countByTier(framework.domains);
  const totalWeight = framework.domains.reduce((s, d) => s + d.weight, 0);

  return (
    <main className="min-h-dvh w-full">
      {/* MASTHEAD */}
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6 flex-wrap">
          <div className="flex items-baseline gap-3">
            <a href="/" className="kicker hover:text-ink">
              ← Kinder Stick OS
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">{ISSUE_DATE}</span>
          </div>
          <div className="flex items-center gap-3">
            {currentUser ? (
              <>
                <a href="/me" className="label-mono hover:text-ink">
                  /me ({currentUser.email?.split("@")[0]})
                </a>
                <a href="/auth/logout" className="label-mono hover:text-ink">
                  logout
                </a>
              </>
            ) : (
              <a href="/auth/login" className="label-mono hover:text-ink">
                Sign in
              </a>
            )}
            <span className="label-mono">DIAGNOSIS / DOMAIN MAP</span>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-14 pb-8">
        <p className="kicker mb-4">No. 03 · 14-도메인 진단 프레임워크</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Reality{" "}
          <span className="text-accent italic font-display">Check</span>
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-ink-soft">
          한국 EdTech 조직의 14-도메인 × {totalGroups}-그룹 ×{" "}
          {totalSubItems}-항목 진단. 각 항목은 Belief(자가 평가) ×
          Evidence(객관 근거) 이중 구조이며 CB Insights·Bessemer·OpenView·
          누리과정·KISA 등 외부 벤치마크에 매핑됩니다.
        </p>

        <div className="mt-6 flex items-center gap-2 flex-wrap">
          <span className="tag tag-filled">v{framework.version}</span>
          <span className="tag">{framework.locale}</span>
          <span className="tag">updated {framework.updated}</span>
          <span className="tag tag-accent">
            가중치 합 {totalWeight}%
          </span>
        </div>
      </section>

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Composition
          </span>
        </div>
      </div>

      {/* SUMMARY METRICS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Domains"
          value={String(framework.domains.length)}
          sub="14 / 14"
        />
        <SummaryCard
          label="Critical"
          value={String(tierCounts.critical)}
          sub={`${Math.round((tierCounts.critical / 14) * 100)}% of 14`}
          tone="accent"
        />
        <SummaryCard
          label="Sub-items"
          value={String(totalSubItems)}
          sub="seeded · target 210"
        />
        <SummaryCard
          label="Failure prior"
          value={`${Math.round(framework.priors.seed.failure_6m * 100)}%`}
          sub="seed stage · 6m baseline"
        />
      </section>

      {/* DIVIDER */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § The 14 Domains
          </span>
        </div>
      </div>

      {/* DOMAIN GRID */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {framework.domains.map((d) => (
          <DomainCard key={d.code} domain={d} />
        ))}
      </section>

      {/* START DIAGNOSIS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-14">
        <div className="area-card">
          <p className="kicker mb-2">Begin / 분기 진단</p>
          <h2 className="font-display text-3xl">
            새 진단 워크스페이스 시작
          </h2>
          <p className="mt-3 text-ink-soft leading-relaxed">
            워크스페이스 ID를 정하고 진단을 시작하세요. 같은 ID로 여러 명이
            응답하면 자동으로 합산되며, 응답자 간 σ가 큰 항목에는 "이견 큼"
            라벨이 표시됩니다. 응답은 익명으로 저장되고 워크스페이스 ID를 아는
            사람만 결과를 봅니다.
          </p>
          <div className="mt-5">
            <StartDiagnosisForm />
          </div>
          <div className="mt-5 dotted-rule pt-4 flex flex-wrap gap-3">
            <a href="/" className="btn-secondary">
              <span className="font-mono text-xs">←</span>
              Smoke Test
            </a>
            <a href="/scoring-test" className="btn-secondary">
              <span className="font-mono text-xs">→</span>
              Scoring engine test
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-20 pb-12 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">
          framework/question_bank.yaml v{framework.version}
        </p>
        <p className="label-mono">{ISSUE_DATE} · domain map</p>
      </footer>
    </main>
  );
}

// ============================================================
// Components
// ============================================================

function tierTagClass(tier: Tier): string {
  switch (tier) {
    case "critical":
      return "tag-accent";
    case "important":
      return "tag-gold";
    case "supporting":
      return "tag";
  }
}

function tierLabel(tier: Tier): string {
  return { critical: "CRITICAL", important: "IMPORTANT", supporting: "SUPPORT" }[
    tier
  ];
}

function DomainCard({ domain }: { domain: Domain }) {
  const subItems = domain.groups.flatMap((g) => g.sub_items);
  const subItemTiers = countByTier(subItems);

  return (
    <article className="area-card flex flex-col h-full">
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="kicker">
            <span className="section-num">No. </span>
            {domain.code}
          </span>
          <p className="mt-1 label-mono">
            가중치 {domain.weight}% · {domain.owner_role.join(" / ")}
          </p>
        </div>
        <span className={`tag ${tierTagClass(domain.tier)}`}>
          {tierLabel(domain.tier)}
        </span>
      </header>

      <h3 className="mt-3 font-display text-2xl leading-tight">
        {domain.name_ko}
      </h3>
      <p className="mt-1 label-mono">{domain.name_en}</p>

      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        {domain.framework}
      </p>

      {/* Threshold bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="label-mono">Threshold (red / yellow / green)</span>
        </div>
        <div className="bar-track bar-bg-pattern">
          <div
            className="bar-fill red"
            style={{ width: `${domain.thresholds.red}%` }}
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

      {/* Groups & sub-items */}
      <div className="mt-4 dotted-rule pt-3">
        <p className="label-mono mb-2">
          {domain.groups.length}개 그룹 · {subItems.length}개 항목
          {subItems.length > 0
            ? ` (critical ${subItemTiers.critical} · important ${subItemTiers.important} · support ${subItemTiers.supporting})`
            : null}
        </p>
        <ul className="space-y-1.5">
          {domain.groups.map((g) => (
            <li
              key={g.code}
              className="flex items-baseline gap-2 text-sm"
            >
              <span className="font-mono text-xs text-ink-soft min-w-[64px]">
                {g.code}
              </span>
              <span>{g.name}</span>
              {g.sub_items.length > 0 ? (
                <span className="ml-auto label-mono">
                  ×{g.sub_items.length}
                </span>
              ) : (
                <span className="ml-auto label-mono opacity-50">empty</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {domain.notes ? (
        <div className="mt-4 note-box text-xs">{domain.notes}</div>
      ) : null}
    </article>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "accent" | "neutral";
}) {
  const valueColor = tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="metric-card">
      <p className="label-mono">{label}</p>
      <p className={`num mt-1 ${valueColor}`}>{value}</p>
      {sub ? <p className="mt-1 label-mono">{sub}</p> : null}
    </div>
  );
}

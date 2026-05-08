import {
  loadFramework,
  countByTier,
  type Domain,
  type Tier,
} from "@/lib/framework/loader";
import StartDiagnosisForm from "./_start-form";
import { getCurrentUser } from "@/lib/supabase/auth";

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

// ============================================================
// 14-domain → 4-group mapping for first-time users.
// (Detailed per-domain view stays available below in <details>.)
// ============================================================
type GroupKey = "market" | "economics" | "people" | "ops";

const DOMAIN_GROUPS: Record<
  GroupKey,
  { title: string; subtitle: string; codes: string[] }
> = {
  market: {
    title: "시장과 제품",
    subtitle: "고객·문제·제품의 적합성",
    codes: ["A1", "A2", "A3", "A4", "A14"],
  },
  economics: {
    title: "자금과 단위경제",
    subtitle: "런웨이·마진·CAC payback",
    codes: ["A5", "A6"],
  },
  people: {
    title: "팀과 문화",
    subtitle: "공동창업자·심리적 안전·핵심인재",
    codes: ["A11", "A13"],
  },
  ops: {
    title: "운영·규제·AI",
    subtitle: "실행 속도·KISA/누리·AI 전환",
    codes: ["A7", "A8", "A9", "A10"],
  },
};

export default async function DiagLandingPage() {
  const framework = loadFramework();
  const currentUser = await getCurrentUser();
  const totalSubItems = framework.domains
    .flatMap((d) => d.groups.flatMap((g) => g.sub_items))
    .length;
  const totalGroups = framework.domains.flatMap((d) => d.groups).length;

  return (
    <main className="min-h-dvh w-full">
      {/* ============== STEP 1 — START WORKSPACE (PRIMARY) ============== */}
      <section className="border-b-2 border-ink bg-paper-soft">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-12 sm:py-14">
          <div className="grid lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-7">
              <div className="flex items-baseline gap-3 mb-4 flex-wrap">
                <span className="kicker">Step 1 · 시작</span>
                <span className="label-mono">·</span>
                <span className="label-mono">25–35분 · 익명</span>
              </div>
              <h1 className="font-display text-4xl sm:text-6xl leading-[1.05] tracking-tight break-keep">
                사업 진단{" "}
                <span className="text-accent italic font-display">시작</span>
              </h1>
              <p className="mt-5 max-w-2xl text-base sm:text-lg leading-relaxed text-ink-soft">
                팀 이름이나 분기명으로{" "}
                <strong className="font-medium text-ink">
                  진단 ID(워크스페이스)
                </strong>
                를 정해 시작하세요. 같은 ID로 팀원이 응답하면 자동으로 합산되고,
                응답은 익명으로 저장됩니다.
                <br />
                <span className="font-medium text-ink">ID는 꼭 메모해 두세요</span>
                 — 결과·코칭·액션을 다시 보려면 같은 ID로 돌아옵니다.
              </p>

              <div className="mt-7 max-w-2xl">
                <StartDiagnosisForm />
              </div>

              <p className="mt-4 label-mono">
                {currentUser
                  ? "로그인됨 · 진단 후 자동으로 본인 계정에 연결됩니다."
                  : "익명으로 시작 가능 · "}
                {!currentUser ? (
                  <a
                    href="/auth/login?next=/diag"
                    className="underline hover:text-ink"
                  >
                    로그인
                  </a>
                ) : null}
                {!currentUser
                  ? " 하면 워크스페이스가 본인 계정에 자동 연결됩니다."
                  : null}
              </p>
            </div>

            <aside className="lg:col-span-5 lg:pl-8 lg:border-l border-ink-soft/40">
              <p className="kicker mb-3">이미 시작했다면</p>
              <a
                href={currentUser ? "/me" : "/auth/login?next=/me"}
                className="block area-card hover:bg-paper-deep/40 transition-colors"
              >
                <p className="font-display text-2xl leading-tight">
                  {currentUser
                    ? "내 워크스페이스 →"
                    : "로그인하고 내 워크스페이스 보기 →"}
                </p>
                <p className="mt-2 text-sm text-ink-soft">
                  참여 중인 워크스페이스 목록과 진행 상황을 한 화면에서 확인.
                </p>
              </a>

              <div className="mt-4 note-box">
                <strong>워크스페이스란?</strong> 우리 팀의 진단 컨테이너입니다.
                응답 · KPI · 코칭 세션 · 액션이 모두 이 ID 하나에 묶여 다음
                분기에 다시 돌아올 때 그대로 이어집니다.
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* ============== STEP 2 — WHAT GETS MEASURED (4 GROUPS) ============== */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-14 pb-6">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="kicker">Step 2 · 무엇을 보나요</span>
        </div>
        <h2 className="font-display text-3xl sm:text-5xl leading-tight tracking-tight break-keep">
          크게 4개 영역,{" "}
          <span className="italic font-light">{framework.domains.length}개 세부 영역</span>
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-soft">
          한 영역만 빨강이어도 다른 영역의 점수를 가립니다 — 평균이 아니라
          치명타를 봅니다. 진단을 시작할 때는 이 정도 윤곽만 알면 충분합니다.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Object.keys(DOMAIN_GROUPS) as GroupKey[]).map((k) => (
          <GroupCard
            key={k}
            group={DOMAIN_GROUPS[k]}
            domains={framework.domains.filter((d) =>
              DOMAIN_GROUPS[k].codes.includes(d.code),
            )}
          />
        ))}
      </section>

      {/* ============== STEP 3 — TIMELINE / WHAT HAPPENS NEXT ============== */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-16 pb-6">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="kicker">Step 3 · 진단 후</span>
        </div>
        <h2 className="font-display text-3xl sm:text-5xl leading-tight tracking-tight break-keep">
          25분 뒤,{" "}
          <span className="italic font-light">손에 쥐는 것</span>
        </h2>
      </section>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-1 md:grid-cols-3 gap-px bg-ink border-2 border-ink">
        <NextCard
          n="1"
          title="14-영역 신호등"
          body="우리 팀이 어디서 빨강인지 30초 안에. 한 영역만 빨강이어도 도메인이 ‘노랑 이상 못 가도록’ 강제로 묶여 있어 평균 환상을 차단."
        />
        <NextCard
          n="2"
          title="이번 주 할 일 3가지"
          body="영역마다 ‘담당자·기한·검증 KPI’가 붙은 SMART 액션 3개. 점수가 아니라 액션이 변화의 단위입니다."
        />
        <NextCard
          n="3"
          title="자동 follow-up"
          body="액션 마감일에 KPI 자동 재측정. 효과 있으면 닫고, 없으면 코치가 다음 단계를 제안. 챙기지 않아도 루프가 돕니다."
        />
      </section>

      {/* ============== FAQ ============== */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-16 pb-6">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="kicker">자주 묻는 질문</span>
        </div>
        <h2 className="font-display text-3xl leading-tight tracking-tight break-keep">
          시작 전 확인하면 좋은 것
        </h2>
      </section>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <FaqCard
          q="얼마나 걸리나요?"
          a="혼자 진단할 경우 25–35분. 팀원 여러 명이 응답하면 동시에 진행해도 좋습니다(같은 ID 사용)."
        />
        <FaqCard
          q="응답이 다른 사람에게 보이나요?"
          a="아니요. 모든 응답은 익명입니다. 결과 화면에는 합산 통계만 나오며, 워크스페이스 ID를 아는 사람만 결과를 봅니다."
        />
        <FaqCard
          q="아직 잘 모르는 항목이 있어요"
          a={
            "‘잘 모르겠다’ 옵션이 있어도 괜찮습니다. 객관적 근거가 없는 항목은 자동으로 ‘근거 부족’으로 표시되고, 진단 후 코치가 ‘이 데이터를 모으세요’ 라는 액션부터 만들어 줍니다."
          }
        />
        <FaqCard
          q="다음 분기에 다시 진단할 수 있나요?"
          a="네. 같은 워크스페이스 ID로 돌아오면 이전 진단·액션·점수 변화가 그대로 이어집니다. 30일 뒤 자동 재측정도 됩니다."
        />
      </section>

      {/* ============== DIVIDER ============== */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-16">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Reference
          </span>
        </div>
      </div>

      {/* ============== EXPANDABLE FRAMEWORK DETAIL ============== */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 pb-12">
        <details className="area-card group">
          <summary className="cursor-pointer flex items-center justify-between gap-4 list-none">
            <div>
              <p className="kicker mb-1">전체 14-영역 자세히 보기</p>
              <p className="font-display text-2xl leading-tight">
                14개 영역 × {totalGroups}개 그룹 × {totalSubItems}개 세부 항목
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                CB Insights · Bessemer · OpenView · 누리과정 · KISA 등 외부
                벤치마크 매핑 (시작에 꼭 필요한 정보는 아닙니다)
              </p>
            </div>
            <span className="font-mono text-xl group-open:rotate-90 transition-transform shrink-0">
              ▶
            </span>
          </summary>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {framework.domains.map((d) => (
              <DomainCard key={d.code} domain={d} />
            ))}
          </div>

          <p className="mt-6 label-mono">
            framework/question_bank.yaml v{framework.version} · updated{" "}
            {framework.updated}
          </p>
        </details>
      </section>

      {/* ============== FOOTER ============== */}
      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 pb-12 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">{ISSUE_DATE}</p>
        <a href="/admin/health" className="label-mono hover:text-ink">
          system health
        </a>
      </footer>
    </main>
  );
}

// ============================================================
// Components
// ============================================================

function GroupCard({
  group,
  domains,
}: {
  group: { title: string; subtitle: string; codes: string[] };
  domains: Domain[];
}) {
  const criticalCount = domains.filter((d) => d.tier === "critical").length;
  const totalWeight = domains.reduce((s, d) => s + d.weight, 0);
  return (
    <article className="area-card flex flex-col">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-display text-2xl leading-tight">{group.title}</h3>
        <span className="label-mono">가중치 {totalWeight}%</span>
      </div>
      <p className="mt-1 label-mono">{group.subtitle}</p>
      <ul className="mt-4 space-y-1.5">
        {domains.map((d) => (
          <li
            key={d.code}
            className="flex items-baseline gap-2 text-sm"
          >
            <span className="font-mono text-xs text-ink-soft min-w-[36px]">
              {d.code}
            </span>
            <span>{d.name_ko}</span>
            {d.tier === "critical" ? (
              <span className="ml-auto tag tag-accent">필수</span>
            ) : d.tier === "important" ? (
              <span className="ml-auto tag tag-gold">중요</span>
            ) : (
              <span className="ml-auto tag">보조</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 dotted-rule pt-3 label-mono">
        필수 영역 {criticalCount}개 · 한 곳만 빨강이어도 그룹 전체가 묶입니다.
      </p>
    </article>
  );
}

function NextCard({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <article className="bg-paper p-6 sm:p-7 flex flex-col">
      <span className="font-display text-3xl text-accent leading-none">{n}</span>
      <h3 className="mt-3 font-display text-xl font-medium leading-tight">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{body}</p>
    </article>
  );
}

function FaqCard({ q, a }: { q: string; a: string }) {
  return (
    <article className="area-card !p-5">
      <h3 className="font-display text-lg leading-tight font-medium">{q}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{a}</p>
    </article>
  );
}

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
  return { critical: "필수", important: "중요", supporting: "보조" }[tier];
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

      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="label-mono">신호등 (빨강 / 노랑 / 초록)</span>
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

      <div className="mt-4 dotted-rule pt-3">
        <p className="label-mono mb-2">
          {domain.groups.length}개 그룹 · {subItems.length}개 항목
          {subItems.length > 0
            ? ` (필수 ${subItemTiers.critical} · 중요 ${subItemTiers.important} · 보조 ${subItemTiers.supporting})`
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

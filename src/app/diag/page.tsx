import {
  loadFramework,
  countByTier,
  type Domain,
  type Tier,
} from "@/lib/framework/loader";
import StartDiagnosisForm from "./_start-form";
import { getCurrentUser } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { aggregateRespondents, type DiagRowMin } from "@/lib/diagnosis-aggregate";

// 새 진단 제출 직후 워크스페이스 카드 목록이 즉시 보여야 함 → 캐시 비활성화.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

// ============================================================
// DEV-ONLY: 모든 워크스페이스 진단 통계
// [TODO PRODUCTION] 로그인 인증 복원 시 user 의 org_members 만 표시하도록 변경.
// ============================================================
interface WorkspaceSummary {
  workspace_id: string;
  respondents: number;
  latest_completed_at: string;
  /**
   * 홈 페이지(`/diag/{ws}/home`) 와 동일한 aggregate 계산 결과.
   * sub-item 단위 합산 + time decay + consensus 보정.
   */
  score: number | null;
  fp_6m: number | null;
  fp_12m: number | null;
  latest_stage: string | null;
}

async function fetchAllWorkspaces(): Promise<WorkspaceSummary[]> {
  const framework = loadFramework();
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("diagnosis_responses")
    .select("workspace_id, completed_at, stage, respondent_num, responses")
    .order("completed_at", { ascending: false })
    .limit(500);

  if (error || !data) return [];

  // 워크스페이스별로 모든 응답 row 모음
  const groups = new Map<
    string,
    {
      workspace_id: string;
      rows: Array<
        DiagRowMin & {
          completed_at: string;
        }
      >;
    }
  >();
  for (const row of data as Array<{
    workspace_id: string;
    completed_at: string;
    stage: string | null;
    respondent_num: number;
    responses: DiagRowMin["responses"];
  }>) {
    const slim: DiagRowMin & { completed_at: string } = {
      respondent_num: row.respondent_num,
      stage: row.stage,
      responses: row.responses,
      completed_at: row.completed_at,
    };
    const existing = groups.get(row.workspace_id);
    if (!existing) {
      groups.set(row.workspace_id, {
        workspace_id: row.workspace_id,
        rows: [slim],
      });
    } else {
      existing.rows.push(slim);
    }
  }

  // 각 워크스페이스마다 home 과 동일한 aggregate 호출
  const out: WorkspaceSummary[] = [];
  for (const g of groups.values()) {
    const sorted = g.rows
      .slice()
      .sort(
        (a, b) =>
          new Date(b.completed_at).getTime() -
          new Date(a.completed_at).getTime(),
      );
    try {
      const agg = aggregateRespondents(framework, g.rows);
      out.push({
        workspace_id: g.workspace_id,
        respondents: g.rows.length,
        latest_completed_at: sorted[0].completed_at,
        score: agg.overall === null ? null : Math.round(agg.overall),
        fp_6m:
          agg.fp["6m"]?.final !== undefined
            ? Math.round(agg.fp["6m"].final * 100)
            : null,
        fp_12m:
          agg.fp["12m"]?.final !== undefined
            ? Math.round(agg.fp["12m"].final * 100)
            : null,
        latest_stage: sorted[0].stage,
      });
    } catch {
      // aggregate 실패 시 빈 점수로 카드만 표시
      out.push({
        workspace_id: g.workspace_id,
        respondents: g.rows.length,
        latest_completed_at: sorted[0].completed_at,
        score: null,
        fp_6m: null,
        fp_12m: null,
        latest_stage: sorted[0].stage,
      });
    }
  }

  return out.sort(
    (a, b) =>
      new Date(b.latest_completed_at).getTime() -
      new Date(a.latest_completed_at).getTime(),
  );
}

const STAGE_LABEL: Record<string, string> = {
  closed_beta: "비공개 베타",
  open_beta: "공개 베타",
  ga_early: "정식 출시",
  ga_growth: "성장기",
  ga_scale: "확장기",
  pre_seed: "비공개 베타",
  seed: "공개 베타",
  series_a: "정식 출시",
  series_b: "성장기",
  series_c_plus: "확장기",
};

function daysAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 1) return "오늘";
  if (diff < 2) return "어제";
  if (diff < 30) return `${Math.floor(diff)}일 전`;
  if (diff < 365) return `${Math.floor(diff / 30)}달 전`;
  return `${Math.floor(diff / 365)}년 전`;
}

// ============================================================
// 14-domain → 4-group mapping for first-time users.
// (Detailed per-domain view stays available below in <details>.)
// ============================================================
// (DOMAIN_GROUPS · GroupKey · GroupCard · NextCard · FaqCard 는 STEP 2/3/FAQ 섹션과 함께 제거됨)
// 14-영역 전체 보기는 EXPANDABLE FRAMEWORK DETAIL 의 DomainCard 가 담당.

export default async function DiagLandingPage() {
  const framework = loadFramework();
  const currentUser = await getCurrentUser();
  const allWorkspaces = await fetchAllWorkspaces();
  const totalSubItems = framework.domains
    .flatMap((d) => d.groups.flatMap((g) => g.sub_items))
    .length;
  const totalGroups = framework.domains.flatMap((d) => d.groups).length;

  return (
    <main className="min-h-dvh w-full">
      {/* ============== STEP 1 — START WORKSPACE ============== */}
      <section className="border-b-2 border-ink bg-paper-soft">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-12 sm:py-14">
          <div className="grid lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-7">
              <div className="flex items-baseline gap-3 mb-4 flex-wrap">
                <span className="kicker">새 진단 카드 만들기</span>
                <span className="label-mono">·</span>
                <span className="label-mono">25–35분 · 익명</span>
              </div>
              <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] tracking-tight break-keep">
                새 진단 카드{" "}
                <span className="text-accent italic font-display">만들기</span>
              </h1>
              <p className="mt-5 max-w-2xl text-base sm:text-lg leading-relaxed text-ink-soft">
                팀 이름이나 분기명으로{" "}
                <strong className="font-medium text-ink">
                  진단 카드 ID
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
                개발 모드 — 로그인 없이 누구나 진단 카드 진입 가능. 위
                목록에서 기존 카드 클릭하거나 새 ID 입력.
              </p>
            </div>

            <aside className="lg:col-span-5 lg:pl-8 lg:border-l border-ink-soft/40">
              <p className="kicker mb-3">진단 카드란?</p>
              <div className="area-card">
                <p className="text-sm leading-relaxed">
                  <strong>우리 팀의 진단·운영 단위</strong>입니다. 응답 · KPI ·
                  코칭 세션 · 액션 · 업무가 모두 이 카드 ID 하나에 묶여 다음
                  분기에 다시 돌아올 때 그대로 이어집니다.
                </p>
                <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                  <li>· 영문·숫자·하이픈 3–50자</li>
                  <li>· 예: <span className="font-mono">acme-2026-q2</span></li>
                  <li>· 같은 ID = 같은 팀 데이터</li>
                </ul>
              </div>

              {currentUser ? (
                <a
                  href="/worklist"
                  className="mt-4 block area-card hover:bg-paper-deep/40 transition-colors"
                >
                  <p className="font-display text-lg leading-tight">
                    내 워크리스트 →
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {currentUser.email}
                  </p>
                </a>
              ) : null}
            </aside>
          </div>
        </div>
      </section>

      {/* ============== ALL WORKSPACES — STEP 1 뒤에 노출 ============== */}
      {allWorkspaces.length > 0 ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-14 pb-10">
          <div className="flex items-baseline gap-3 mb-3 flex-wrap">
            <span className="kicker">진단 카드</span>
            <span className="label-mono">·</span>
            <span className="label-mono">
              총 {allWorkspaces.length}개 · 클릭하면 바로 홈으로
            </span>
            <span className="tag tag-gold ml-auto">개발 모드</span>
          </div>
          <h2 className="font-display text-3xl sm:text-5xl leading-[1.05] tracking-tight break-keep mb-6">
            어느 진단 카드로 들어가시겠어요?
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allWorkspaces.slice(0, 12).map((ws) => {
              const tone =
                ws.score === null
                  ? "neutral"
                  : ws.score >= 70
                    ? "green"
                    : ws.score >= 40
                      ? "amber"
                      : "red";
              return (
                <div
                  key={ws.workspace_id}
                  className={`border-2 p-4 transition-colors ${
                    tone === "red"
                      ? "border-signal-red/60"
                      : tone === "amber"
                        ? "border-signal-amber/60"
                        : tone === "green"
                          ? "border-signal-green/60"
                          : "border-ink-soft/40"
                  }`}
                >
                  <p className="font-mono text-sm font-medium truncate mb-2">
                    {ws.workspace_id}
                  </p>

                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className={`font-display text-3xl leading-none ${
                        tone === "red"
                          ? "text-signal-red"
                          : tone === "amber"
                            ? "text-signal-amber"
                            : tone === "green"
                              ? "text-signal-green"
                              : "text-ink"
                      }`}
                    >
                      {ws.score ?? "—"}
                    </span>
                    <span className="text-sm text-ink-soft">/ 100</span>
                    <span
                      className={`label-mono ml-auto ${
                        tone === "red"
                          ? "!text-signal-red"
                          : tone === "amber"
                            ? "!text-signal-amber"
                            : tone === "green"
                              ? "!text-signal-green"
                              : ""
                      }`}
                    >
                      {ws.score === null
                        ? "측정 안 됨"
                        : tone === "green"
                          ? "● 양호"
                          : tone === "amber"
                            ? "● 주의"
                            : tone === "red"
                              ? "● 위험"
                              : ""}
                    </span>
                  </div>
                  <p className="label-mono">종합 건강도 (0–100점)</p>

                  <p className="mt-2 label-mono">
                    응답자 {ws.respondents}명 · {daysAgo(ws.latest_completed_at)}
                    {ws.latest_stage
                      ? ` · ${STAGE_LABEL[ws.latest_stage] ?? ws.latest_stage}`
                      : ""}
                    {ws.fp_6m !== null ? ` · 6m 위험 ${ws.fp_6m}%` : ""}
                  </p>
                  {/* 카드 안에 워크스페이스 모든 진입점 통합 (이전 secondary nav 대체) */}
                  <div className="mt-3 pt-3 border-t border-ink-soft/30">
                    {/* 자주 쓰는 4개 — 큰 버튼 그리드 */}
                    <div className="grid grid-cols-2 gap-2">
                      <a
                        href={`/diag/${ws.workspace_id}/home`}
                        className="text-center px-2 py-2 border-2 border-ink text-xs font-medium hover:bg-ink hover:text-paper transition-colors"
                        title="종합 점수·이번 주 할 일·도메인 신호등"
                      >
                        홈
                      </a>
                      <a
                        href={`/diag/${ws.workspace_id}`}
                        className="text-center px-2 py-2 border border-ink-soft/60 text-xs hover:border-ink hover:bg-paper-deep/40 transition-colors"
                        title="진단 시작 — 새 응답·재진단"
                      >
                        진단 시작
                      </a>
                      <a
                        href={`/diag/${ws.workspace_id}/actions`}
                        className="text-center px-2 py-2 border border-ink-soft/60 text-xs hover:border-ink hover:bg-paper-deep/40 transition-colors"
                      >
                        액션
                      </a>
                      <a
                        href={`/diag/${ws.workspace_id}/worklist`}
                        className="text-center px-2 py-2 border border-ink-soft/60 text-xs hover:border-ink hover:bg-paper-deep/40 transition-colors"
                      >
                        워크리스트
                      </a>
                    </div>

                    {/* 가끔 쓰는 항목 — 작은 링크 모음 */}
                    <div className="mt-2 pt-2 border-t border-dotted border-ink-soft/30 flex flex-wrap gap-x-3 gap-y-1">
                      <a
                        href={`/diag/${ws.workspace_id}/timeline`}
                        className="label-mono hover:text-ink"
                      >
                        타임라인
                      </a>
                      <a
                        href={`/diag/${ws.workspace_id}/result`}
                        className="label-mono hover:text-ink"
                      >
                        결과 상세
                      </a>
                      <a
                        href={`/diag/${ws.workspace_id}/signals`}
                        className="label-mono hover:text-ink"
                      >
                        시그널
                      </a>
                      <a
                        href={`/diag/${ws.workspace_id}/audit`}
                        className="label-mono hover:text-ink"
                      >
                        감사
                      </a>
                      <a
                        href={`/diag/${ws.workspace_id}/members`}
                        className="label-mono hover:text-ink"
                      >
                        멤버
                      </a>
                      <a
                        href={`/diag/${ws.workspace_id}/integrations`}
                        className="label-mono hover:text-ink"
                      >
                        연동
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {allWorkspaces.length > 12 ? (
            <p className="mt-4 label-mono">
              상위 12개만 표시. 새 카드로 시작하려면 위 폼 사용.
            </p>
          ) : null}
        </section>
      ) : null}

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

// GroupCard / NextCard / FaqCard 는 STEP 2/3/FAQ 섹션과 함께 제거.

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

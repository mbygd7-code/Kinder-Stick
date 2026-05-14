/**
 * /worklist — 내 워크리스트 hub.
 *
 * 첫 화면에는 워크리스트가 직접 보이지 않고, 진단 카드 그리드 + 카드별
 * 대표 메타 (진단 점수·진척률·이번 주 마감 액션 개수). "업무 리스트 →"
 * 버튼을 누르면 해당 카드의 워크리스트로 진입 (팀별/전체 필터 가능).
 *
 * SSR 페이지 (server component). 마지막 진입한 워크스페이스 redirect 로직은
 * 더 이상 사용 안 함 — 카드 그리드를 항상 보여준다.
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFramework } from "@/lib/framework/loader";
import { getStageLabel } from "@/lib/stage-labels";
import { relativeKo as daysAgo } from "@/lib/date-utils";
import {
  aggregateRespondents,
  type DiagRowMin,
} from "@/lib/diagnosis-aggregate";
import { fetchDiagnosisProfilesBatch } from "@/lib/diagnosis-profile/server-fetch";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

interface CardData {
  workspace_id: string;
  respondents: number;
  latest_completed_at: string;
  score: number | null;
  fp_6m: number | null;
  red_critical_count: number;
  latest_stage: string | null;
  /** 마감 임박 액션 수 (이번 주) */
  due_actions: number;
  /** 진행 중인 빨강 critical 코치 세션 수 */
  pending_findings: number;
}


async function fetchCards(): Promise<CardData[]> {
  const framework = loadFramework();
  const sb = supabaseAdmin();

  // 진단 응답을 한 모든 워크스페이스 row
  const { data: diagData } = await sb
    .from("diagnosis_responses")
    .select("workspace_id, completed_at, stage, respondent_num, responses")
    .order("completed_at", { ascending: false })
    .limit(500);
  if (!diagData) return [];

  // organizations 매핑 — workspace name → org_id
  const wsIds = Array.from(
    new Set((diagData as Array<{ workspace_id: string }>).map((r) => r.workspace_id)),
  );
  const { data: orgs } = await sb
    .from("organizations")
    .select("id, name")
    .in("name", wsIds);
  const orgIdByWs = new Map<string, string>(
    ((orgs ?? []) as Array<{ id: string; name: string }>).map((o) => [
      o.name,
      o.id,
    ]),
  );

  // 액션·세션 통계 한꺼번에 (org_id 기반)
  const orgIds = Array.from(orgIdByWs.values());
  const [actionsRes, sessionsRes] = await Promise.all([
    orgIds.length
      ? sb
          .from("coaching_actions")
          .select("org_id, status, deadline")
          .in("org_id", orgIds)
      : { data: [] as Array<{ org_id: string; status: string; deadline: string | null }> },
    orgIds.length
      ? sb
          .from("agent_sessions")
          .select("org_id, severity, state, domain_code")
          .in("org_id", orgIds)
          .in("state", ["action_planning", "analyzing", "diagnosing", "evidence_request"])
          .not("domain_code", "in", "(A5,A12)")
      : { data: [] as Array<{ org_id: string; severity: number }> },
  ]);

  const dueByOrg = new Map<string, number>();
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  for (const a of (actionsRes.data ?? []) as Array<{
    org_id: string;
    status: string;
    deadline: string | null;
  }>) {
    if (
      (a.status === "accepted" || a.status === "in_progress") &&
      a.deadline &&
      new Date(a.deadline).getTime() < now + SEVEN_DAYS
    ) {
      dueByOrg.set(a.org_id, (dueByOrg.get(a.org_id) ?? 0) + 1);
    }
  }
  const findingsByOrg = new Map<string, number>();
  for (const s of (sessionsRes.data ?? []) as Array<{
    org_id: string;
    severity: number;
  }>) {
    if (s.severity >= 4) {
      findingsByOrg.set(s.org_id, (findingsByOrg.get(s.org_id) ?? 0) + 1);
    }
  }

  // 카드별 aggregate
  const groups = new Map<
    string,
    {
      workspace_id: string;
      rows: Array<DiagRowMin & { completed_at: string }>;
    }
  >();
  for (const row of diagData as Array<{
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

  // 워크스페이스별 진단 적응 프로필 batch fetch
  const profilesByWs = await fetchDiagnosisProfilesBatch(
    Array.from(groups.keys()),
  );

  const out: CardData[] = [];
  for (const g of groups.values()) {
    const sorted = g.rows
      .slice()
      .sort(
        (a, b) =>
          new Date(b.completed_at).getTime() -
          new Date(a.completed_at).getTime(),
      );
    const orgId = orgIdByWs.get(g.workspace_id);
    try {
      const agg = aggregateRespondents(
        framework,
        g.rows,
        [],
        profilesByWs[g.workspace_id] ?? null,
      );
      out.push({
        workspace_id: g.workspace_id,
        respondents: g.rows.length,
        latest_completed_at: sorted[0].completed_at,
        score: agg.overall === null ? null : Math.round(agg.overall),
        fp_6m:
          agg.fp["6m"]?.final !== undefined
            ? Math.round(agg.fp["6m"].final * 100)
            : null,
        red_critical_count: agg.fp["6m"]?.red_critical_domains?.length ?? 0,
        latest_stage: sorted[0].stage,
        due_actions: orgId ? dueByOrg.get(orgId) ?? 0 : 0,
        pending_findings: orgId ? findingsByOrg.get(orgId) ?? 0 : 0,
      });
    } catch {
      out.push({
        workspace_id: g.workspace_id,
        respondents: g.rows.length,
        latest_completed_at: sorted[0].completed_at,
        score: null,
        fp_6m: null,
        red_critical_count: 0,
        latest_stage: sorted[0].stage,
        due_actions: orgId ? dueByOrg.get(orgId) ?? 0 : 0,
        pending_findings: orgId ? findingsByOrg.get(orgId) ?? 0 : 0,
      });
    }
  }

  return out.sort(
    (a, b) =>
      new Date(b.latest_completed_at).getTime() -
      new Date(a.latest_completed_at).getTime(),
  );
}

export default async function WorklistHubPage() {
  const cards = await fetchCards();

  return (
    <main className="min-h-dvh w-full pb-20">
      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-3">내 워크리스트</p>
        <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] tracking-tight break-keep">
          어느 진단 카드의{" "}
          <span className="italic font-light">업무</span>를 볼까요?
        </h1>
        <p className="mt-5 max-w-3xl text-base sm:text-lg leading-relaxed text-ink-soft">
          진단 카드마다 그 회사·팀의 운영 업무가 분리됩니다.
          카드 아래의 <strong className="font-medium text-ink">업무 리스트 →</strong>{" "}
          버튼을 누르면 팀별로 필터해서 한 자리에서 체크할 수 있습니다.
        </p>
      </section>

      {/* DIAGNOSIS CARDS */}
      {cards.length === 0 ? (
        <section className="max-w-3xl mx-auto px-6 sm:px-10 mt-10 text-center">
          <div className="border-2 border-ink-soft/40 bg-paper-soft p-8">
            <p className="kicker mb-2">진단 카드 없음</p>
            <h2 className="font-display text-2xl">
              아직 진단한 회사·팀이 없습니다
            </h2>
            <p className="mt-3 text-sm text-ink-soft leading-relaxed">
              업무 리스트는 진단 카드(회사·팀 단위) 안에서 운영됩니다.
              먼저 진단을 시작하면 그 카드의 업무 리스트도 자동 생성됩니다.
            </p>
            <a href="/diag" className="btn-primary mt-6 inline-flex">
              진단 시작 →
            </a>
          </div>
        </section>
      ) : (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => {
            const tone =
              c.score === null
                ? "neutral"
                : c.score >= 70
                  ? "green"
                  : c.score >= 40
                    ? "amber"
                    : "red";
            return (
              <article
                key={c.workspace_id}
                className={`border-2 p-5 sm:p-6 flex flex-col transition-colors ${
                  tone === "red"
                    ? "border-signal-red/60"
                    : tone === "amber"
                      ? "border-signal-amber/60"
                      : tone === "green"
                        ? "border-signal-green/60"
                        : "border-ink-soft/40"
                }`}
              >
                {/* 카드 ID + 메타 */}
                <header className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                  <p className="kicker">진단 카드</p>
                  <span className="label-mono">
                    응답자 {c.respondents}명 · {daysAgo(c.latest_completed_at)}
                  </span>
                </header>
                <h2 className="font-display text-2xl leading-tight font-mono break-all">
                  {c.workspace_id}
                </h2>
                <p className="mt-1 label-mono">
                  {c.latest_stage
                    ? getStageLabel(c.latest_stage)
                    : "단계 미입력"}
                </p>

                {/* 큰 점수 + 6m 위험 */}
                <div className="mt-4 pt-4 border-t border-ink-soft/30 grid grid-cols-2 gap-4">
                  <div>
                    <p className="kicker mb-1">종합 건강도</p>
                    <p
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
                      {c.score ?? "—"}
                      <span className="text-base text-ink-soft"> / 100</span>
                    </p>
                  </div>
                  <div>
                    <p className="kicker mb-1">6개월 어려움</p>
                    <p
                      className={`font-display text-3xl leading-none ${
                        c.fp_6m === null
                          ? "text-ink"
                          : c.fp_6m >= 45
                            ? "text-signal-red"
                            : c.fp_6m >= 25
                              ? "text-signal-amber"
                              : "text-signal-green"
                      }`}
                    >
                      {c.fp_6m ?? "—"}
                      <span className="text-base text-ink-soft">%</span>
                    </p>
                  </div>
                </div>

                {/* 운영 시그널 — 마감 임박·긴급 코칭·빨강 critical */}
                <div className="mt-3 pt-3 border-t border-dotted border-ink-soft/30 flex flex-wrap gap-2">
                  {c.due_actions > 0 ? (
                    <span className="tag tag-red">
                      마감 임박 액션 {c.due_actions}
                    </span>
                  ) : (
                    <span className="tag tag-green">마감 임박 0</span>
                  )}
                  {c.pending_findings > 0 ? (
                    <span className="tag tag-red">
                      긴급 코칭 {c.pending_findings}
                    </span>
                  ) : null}
                  {c.red_critical_count > 0 ? (
                    <span className="tag tag-red">
                      빨강 영역 {c.red_critical_count}
                    </span>
                  ) : null}
                </div>

                {/* CTA */}
                <div className="mt-auto pt-5 flex gap-2 flex-wrap">
                  <a
                    href={`/diag/${c.workspace_id}/worklist`}
                    className="flex-1 text-center px-4 py-2.5 border-2 border-ink bg-ink text-paper text-sm font-semibold hover:bg-accent hover:border-accent transition-colors"
                  >
                    업무 리스트 →
                  </a>
                  <a
                    href={`/diag/${c.workspace_id}/home`}
                    className="flex-1 text-center px-4 py-2.5 border-2 border-ink-soft/60 text-sm hover:border-ink hover:bg-paper-deep/40 transition-colors"
                  >
                    카드 홈 →
                  </a>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* FOOTER */}
      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a href="/diag" className="label-mono hover:text-ink">
          + 새 진단 카드 만들기
        </a>
        <p className="label-mono">{ISSUE_DATE} · worklist hub v1</p>
      </footer>
    </main>
  );
}

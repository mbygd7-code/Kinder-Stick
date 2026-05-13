/**
 * Server component — 랜딩 페이지 hero 우측에 들어가는 종합 카드.
 *
 * 로그인 한 사용자: 본인이 보유/응답한 모든 진단 카드의 가중 종합값
 * 비로그인: 기존 "이 시스템이 답하는 질문" 3개 질문 리스트 (fallback)
 *
 * 디자인 원칙:
 *   - editorial — 박스 두 겹 X. 큰 숫자 + 미세 라벨 + dotted-rule 구분
 *   - 한 줄 narrative (no 차트)
 *   - 카드 클릭하면 워크리스트 / 진단 카드 hub 로 이동
 */

import { getCurrentProfile } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFramework } from "@/lib/framework/loader";
import { aggregateCrossCard } from "@/lib/cross-card-aggregate";
import { TEAM_LABEL } from "@/lib/auth/pin";

const STAGE_LABEL: Record<string, string> = {
  closed_beta: "비공개 베타",
  open_beta: "공개 베타",
  ga_early: "정식 출시",
  ga_growth: "성장기",
  ga_scale: "확장기",
};

export async function AggregateSummary() {
  const me = await getCurrentProfile().catch(() => null);

  // ── 비로그인: fallback (기존 질문 리스트) ──
  if (!me) {
    return (
      <aside className="lg:col-span-4 lg:pl-8 lg:border-l border-ink-soft/40">
        <p className="kicker mb-3">로그인하면 한눈에</p>
        <ul className="space-y-3 mb-5">
          <Q text="우리 팀이 진단한 모든 카드의 종합 건강도" />
          <Q text="가장 위험한 카드 1개 — 우선순위 자동 정렬" />
          <Q text="팀별 응답 비교 — 누가 어떻게 봤는가" />
        </ul>
        <div className="flex flex-col gap-2">
          <a href="/auth/signup" className="btn-primary text-sm">
            가입 후 한눈에 보기
            <span className="font-mono text-xs">→</span>
          </a>
          <a
            href="/auth/login"
            className="label-mono hover:text-ink"
          >
            ← 이미 가입했음
          </a>
        </div>
      </aside>
    );
  }

  // ── 로그인: 종합 데이터 ──
  const sb = supabaseAdmin();

  // 사용 가능한 모든 응답 (현 단계: 모든 ws 노출. 향후 org_members RLS 로 제한)
  const { data: rows } = await sb
    .from("diagnosis_responses")
    .select("workspace_id, respondent_num, stage, responses, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  type DiagRow = {
    workspace_id: string;
    respondent_num: number;
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
  };
  const list = ((rows ?? []) as DiagRow[]).map((r) => ({
    workspace_id: r.workspace_id,
    respondent_num: r.respondent_num,
    stage: r.stage,
    responses: r.responses,
  }));

  if (list.length === 0) {
    return (
      <aside className="lg:col-span-4 lg:pl-8 lg:border-l border-ink-soft/40">
        <p className="kicker mb-2">아직 진단 데이터 없음</p>
        <p className="text-sm text-ink-soft leading-relaxed mb-5">
          첫 진단 카드를 만들고 응답하면 여기에 종합 건강도가 표시됩니다.
        </p>
        <a href="/diag" className="btn-primary text-sm">
          첫 진단 시작
          <span className="font-mono text-xs">→</span>
        </a>
      </aside>
    );
  }

  const framework = loadFramework();
  const agg = aggregateCrossCard(framework, list);

  const overall = agg.combined.overall;
  const fail6 = Math.round(agg.combined.failure_6m * 100);
  const fail12 = Math.round(agg.combined.failure_12m * 100);
  const cardCount = agg.per_workspace.length;
  const totalResp = agg.combined.total_responses;

  // narrative
  const overallText =
    overall === null
      ? "데이터 부족"
      : overall >= 75
        ? "양호"
        : overall >= 60
          ? "보통"
          : overall >= 45
            ? "주의"
            : "시급";

  const overallTone =
    overall === null
      ? "text-ink-soft"
      : overall >= 75
        ? "text-signal-green"
        : overall >= 60
          ? "text-cobalt"
          : overall >= 45
            ? "text-signal-amber"
            : "text-signal-red";

  const teamLabel = me.team ? TEAM_LABEL[me.team] : "팀 미지정";

  return (
    <aside className="lg:col-span-4 lg:pl-8 lg:border-l border-ink-soft/40 self-start">
      {/* Identity strip */}
      <div className="flex items-baseline gap-2 flex-wrap mb-4">
        <span className="kicker">
          {me.role === "admin" ? "관리자" : teamLabel}
        </span>
        <span className="label-mono opacity-40">·</span>
        <span className="label-mono">{me.email}</span>
      </div>

      <p className="kicker mb-2">우리 팀 종합 건강도</p>

      {/* Big number */}
      <div className="flex items-end gap-3 mb-1">
        <span className={`font-display text-7xl leading-none ${overallTone}`}>
          {overall !== null ? Math.round(overall) : "—"}
        </span>
        {overall !== null ? (
          <span className="label-mono mb-2">/ 100</span>
        ) : null}
      </div>
      <p className={`font-display text-xl leading-tight ${overallTone}`}>
        {overallText}
      </p>

      {/* Stats grid */}
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 dotted-rule pt-4">
        <div>
          <dt className="label-mono">6개월 어려움</dt>
          <dd className="font-display text-2xl leading-none mt-1">
            {fail6}
            <span className="font-mono text-xs text-ink-soft">%</span>
          </dd>
        </div>
        <div>
          <dt className="label-mono">12개월 어려움</dt>
          <dd className="font-display text-2xl leading-none mt-1">
            {fail12}
            <span className="font-mono text-xs text-ink-soft">%</span>
          </dd>
        </div>
        <div>
          <dt className="label-mono">진단 카드</dt>
          <dd className="font-display text-2xl leading-none mt-1">
            {cardCount}
            <span className="font-mono text-xs text-ink-soft">개</span>
          </dd>
        </div>
        <div>
          <dt className="label-mono">누적 응답</dt>
          <dd className="font-display text-2xl leading-none mt-1">
            {totalResp}
            <span className="font-mono text-xs text-ink-soft">건</span>
          </dd>
        </div>
      </dl>

      {/* Worst card highlight */}
      {agg.worst ? (
        <div className="mt-5 pt-4 border-t border-ink-soft/30">
          <p className="kicker !text-signal-red mb-2">가장 시급한 카드</p>
          <a
            href={`/diag/${agg.worst.workspace_id}/home`}
            className="block hover:bg-paper-deep -mx-2 px-2 py-1 transition-colors"
          >
            <p className="font-mono text-sm truncate text-ink font-medium">
              {agg.worst.workspace_id}
            </p>
            <p className="label-mono mt-0.5">
              {agg.worst.stage ? STAGE_LABEL[agg.worst.stage] ?? agg.worst.stage : "단계 미정"}
              {" · "}
              6개월 {Math.round(agg.worst.fp["6m"].final * 100)}%
              {" · "}
              {agg.worst.respondent_count}명 응답
            </p>
          </a>
        </div>
      ) : null}

      {/* CTA */}
      <div className="mt-5 pt-4 border-t border-ink-soft/30 flex flex-col gap-1">
        <a href="/diag" className="label-mono hover:text-ink">
          모든 진단 카드 →
        </a>
        <a href="/worklist" className="label-mono hover:text-ink">
          내 워크리스트 →
        </a>
      </div>
      <p className="mt-4 label-mono text-ink-soft/70 leading-relaxed">
        · 가중치: 동일 카드 1.0 · 타 카드 0.3
        <br />· 8요인 log-LR 모델
      </p>
    </aside>
  );
}

function Q({ text }: { text: string }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="font-display text-xl text-accent">·</span>
      <span className="text-base leading-relaxed">“{text}”</span>
    </li>
  );
}

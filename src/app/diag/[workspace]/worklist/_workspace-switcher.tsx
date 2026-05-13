/**
 * 워크스페이스 선택 카드 그리드 — 워크리스트 페이지 상단.
 *
 * 사용자가 다른 워크스페이스의 업무 리스트로 빠르게 전환할 수 있게.
 * 현재 워크스페이스는 강조 (accent 보더).
 * 카드 클릭 = 그 워크스페이스의 worklist 로 이동.
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { loadFramework } from "@/lib/framework/loader";
import { aggregateRespondents, type DiagRowMin } from "@/lib/diagnosis-aggregate";

interface CardSummary {
  workspace_id: string;
  respondents: number;
  latest_completed_at: string;
  score: number | null;
  latest_stage: string | null;
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

async function fetchAll(): Promise<CardSummary[]> {
  const framework = loadFramework();
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("diagnosis_responses")
    .select("workspace_id, completed_at, stage, respondent_num, responses")
    .order("completed_at", { ascending: false })
    .limit(500);
  if (!data) return [];

  const groups = new Map<
    string,
    {
      workspace_id: string;
      rows: Array<DiagRowMin & { completed_at: string }>;
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

  const out: CardSummary[] = [];
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
        latest_stage: sorted[0].stage,
      });
    } catch {
      out.push({
        workspace_id: g.workspace_id,
        respondents: g.rows.length,
        latest_completed_at: sorted[0].completed_at,
        score: null,
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

export async function WorkspaceSwitcherCards({
  current,
}: {
  current: string;
}) {
  const all = await fetchAll();

  if (all.length === 0) {
    return null;
  }

  return (
    <div className="border-2 border-ink-soft/40 bg-paper-soft p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="kicker mb-1">진단 카드 선택</p>
          <h2 className="font-display text-xl sm:text-2xl leading-tight">
            어느 진단 카드의 업무를 볼까요?
          </h2>
          <p className="mt-1 label-mono">
            카드를 클릭하면 그 진단 카드의 업무 리스트로 이동합니다.
          </p>
        </div>
        <a
          href="/diag"
          className="label-mono hover:text-ink"
        >
          + 새 진단 카드
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {all.slice(0, 12).map((ws) => {
          const isCurrent = ws.workspace_id === current;
          const tone =
            ws.score === null
              ? "neutral"
              : ws.score >= 70
                ? "green"
                : ws.score >= 40
                  ? "amber"
                  : "red";
          return (
            <a
              key={ws.workspace_id}
              href={`/diag/${ws.workspace_id}/worklist`}
              className={`block border-2 p-3 transition-colors ${
                isCurrent
                  ? "border-accent bg-accent/10"
                  : tone === "red"
                    ? "border-signal-red/60 hover:bg-paper-deep/30"
                    : tone === "amber"
                      ? "border-signal-amber/60 hover:bg-paper-deep/30"
                      : tone === "green"
                        ? "border-signal-green/60 hover:bg-paper-deep/30"
                        : "border-ink-soft/40 hover:bg-paper-deep/30"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="font-mono text-xs font-medium truncate">
                  {ws.workspace_id}
                </span>
                {isCurrent ? (
                  <span className="label-mono !text-accent">● 현재</span>
                ) : null}
              </div>
              <div className="flex items-baseline gap-1">
                <span
                  className={`font-display text-2xl leading-none ${
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
                <span className="text-xs text-ink-soft">/ 100</span>
              </div>
              <p className="mt-1 label-mono">
                응답자 {ws.respondents}명 · {daysAgo(ws.latest_completed_at)}
                {ws.latest_stage
                  ? ` · ${STAGE_LABEL[ws.latest_stage] ?? ws.latest_stage}`
                  : ""}
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}

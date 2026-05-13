"use client";

import { useEffect, useState } from "react";
import {
  STATUS_LABEL,
  TEAM_LABEL,
  type Status,
  type Team,
  type Task,
} from "@/lib/worklist/catalog";
import type { AutoStatus } from "@/lib/worklist/derive";

interface Props {
  workspace: string;
  tasks: Task[];
  autoMap: Record<string, AutoStatus>;
}

const STATUS_DOT: Record<Status, string> = {
  done: "bg-green",
  in_progress: "bg-amber",
  scheduled: "bg-cobalt",
  not_started: "bg-ink-soft/40",
};

export function ProgressStrip({ workspace, tasks, autoMap }: Props) {
  // SSR-safe pattern: 첫 렌더는 localStorage 없이 auto-status 만으로 계산해서
  // 서버 출력과 일치시킴. mount 후 tick으로 다시 계산해서 클라이언트 override 반영.
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    setMounted(true);
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("worklist:change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("worklist:change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const eff = effectiveStatuses(workspace, tasks, autoMap, mounted);

  const totalsByStatus: Record<Status, number> = {
    done: 0,
    in_progress: 0,
    scheduled: 0,
    not_started: 0,
  };
  const mustOnly: Record<Status, number> = {
    done: 0,
    in_progress: 0,
    scheduled: 0,
    not_started: 0,
  };
  const byTeam: Record<Team, { done: number; total: number }> = {
    director: { done: 0, total: 0 },
    planning: { done: 0, total: 0 },
    design: { done: 0, total: 0 },
    engineering: { done: 0, total: 0 },
    operations: { done: 0, total: 0 },
    marketing: { done: 0, total: 0 },
  };

  for (const t of tasks) {
    const s = eff[t.id];
    totalsByStatus[s] += 1;
    if (t.tier === "must") mustOnly[s] += 1;
    byTeam[t.team].total += 1;
    if (s === "done") byTeam[t.team].done += 1;
  }

  const total = tasks.length;
  const mustTotal = tasks.filter((t) => t.tier === "must").length;

  const pct = total > 0 ? Math.round((totalsByStatus.done / total) * 100) : 0;
  const mustPct = mustTotal > 0
    ? Math.round((mustOnly.done / mustTotal) * 100)
    : 0;

  return (
    <div className="border-2 border-ink bg-paper-soft p-5 sm:p-6">
      <div className="flex items-baseline justify-between flex-wrap gap-4 mb-4">
        <div>
          <p className="kicker mb-1">전체 진행 현황</p>
          <p className="font-display text-2xl sm:text-3xl leading-tight">
            필수 {mustOnly.done} / {mustTotal} 완료{" "}
            <span className="font-mono text-base text-ink-soft">
              · 전체 {totalsByStatus.done} / {total}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3 label-mono">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT.done}`} />
            완료 {totalsByStatus.done}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT.in_progress}`} />
            진행 {totalsByStatus.in_progress}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT.scheduled}`} />
            예정 {totalsByStatus.scheduled}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT.not_started}`} />
            안 함 {totalsByStatus.not_started}
          </span>
        </div>
      </div>

      {/* segmented bar — must vs all */}
      <div className="space-y-2">
        <SegmentedBar
          label="필수 항목"
          total={mustTotal}
          counts={mustOnly}
        />
        <SegmentedBar
          label="전체 항목"
          total={total}
          counts={totalsByStatus}
        />
      </div>

      {/* per-team mini-bar — 클릭 시 해당 팀 업무 리스트 헤더로 스크롤 */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(Object.keys(byTeam) as Team[]).map((tm) => {
          const { done, total } = byTeam[tm];
          const p = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <button
              key={tm}
              type="button"
              onClick={() => scrollToTeam(tm)}
              className="text-left border border-ink-soft/40 bg-paper p-3 hover:border-ink hover:bg-paper-deep/40 transition-colors cursor-pointer group"
              title={`${TEAM_LABEL[tm]} 업무 리스트로 이동`}
              aria-label={`${TEAM_LABEL[tm]} 섹션으로 스크롤 (완료 ${done}/${total})`}
            >
              <p className="label-mono mb-1 truncate flex items-center justify-between gap-1">
                <span className="truncate">{TEAM_LABEL[tm]}</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-ink shrink-0">
                  ↓
                </span>
              </p>
              <p className="font-display text-xl leading-none">
                {done}
                <span className="font-mono text-xs text-ink-soft">
                  /{total}
                </span>
              </p>
              <div className="mt-2 h-1.5 bg-paper-deep border border-ink-soft/30 overflow-hidden">
                <div
                  className="h-full bg-green"
                  style={{ width: `${p}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* sentence */}
      <p className="mt-5 text-sm text-ink-soft">
        {mustPct === 100
          ? "필수 업무는 모두 끝났습니다 — 정기 항목으로 운영을 이어가세요."
          : `필수 업무 ${mustPct}% 진행 중. 미완료 항목을 우선 처리하세요.`}
        <span className="ml-2 label-mono">전체 진행률 {pct}%</span>
      </p>
    </div>
  );
}

function SegmentedBar({
  label,
  total,
  counts,
}: {
  label: string;
  total: number;
  counts: Record<Status, number>;
}) {
  if (total === 0) return null;
  const segs: { key: Status; w: number }[] = [
    { key: "done", w: (counts.done / total) * 100 },
    { key: "in_progress", w: (counts.in_progress / total) * 100 },
    { key: "scheduled", w: (counts.scheduled / total) * 100 },
    { key: "not_started", w: (counts.not_started / total) * 100 },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="label-mono">{label}</span>
        <span className="label-mono">
          {counts.done} / {total}
        </span>
      </div>
      <div className="flex h-2 border border-ink-soft/40 overflow-hidden">
        {segs.map((s) => (
          <div
            key={s.key}
            className={STATUS_DOT[s.key]}
            style={{ width: `${s.w}%` }}
            title={`${STATUS_LABEL[s.key]} ${counts[s.key]}`}
          />
        ))}
      </div>
    </div>
  );
}

function scrollToTeam(team: Team) {
  if (typeof window === "undefined") return;
  const el = document.querySelector(
    `[data-team-section="${team}"]`,
  ) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // 살짝 하이라이트 (잠깐 깜빡 효과)
  el.classList.add("ring-2", "ring-ink", "ring-offset-2", "ring-offset-paper");
  window.setTimeout(() => {
    el.classList.remove(
      "ring-2",
      "ring-ink",
      "ring-offset-2",
      "ring-offset-paper",
    );
  }, 1200);
}

function effectiveStatuses(
  workspace: string,
  tasks: Task[],
  autoMap: Record<string, AutoStatus>,
  useLocalStorage: boolean,
): Record<string, Status> {
  const out: Record<string, Status> = {};
  for (const t of tasks) {
    let s: Status;
    const a = autoMap[t.id] ?? "unknown";
    const autoDefault: Status = a === "unknown" ? "not_started" : a;
    // SSR / 첫 렌더에서는 localStorage 조회를 건너뛰어 서버와 일치 보장.
    if (!useLocalStorage) {
      out[t.id] = autoDefault;
      continue;
    }
    try {
      const raw = window.localStorage.getItem(
        `worklist:${workspace}:${t.id}`,
      );
      if (raw) {
        const parsed = JSON.parse(raw) as { status: Status };
        s = parsed.status;
      } else {
        s = autoDefault;
      }
    } catch {
      s = autoDefault;
    }
    out[t.id] = s;
  }
  return out;
}

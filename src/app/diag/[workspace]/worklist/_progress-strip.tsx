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
  const [, setTick] = useState(0);
  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("worklist:change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("worklist:change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const eff = effectiveStatuses(workspace, tasks, autoMap);

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

      {/* per-team mini-bar */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(Object.keys(byTeam) as Team[]).map((tm) => {
          const { done, total } = byTeam[tm];
          const p = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <div key={tm} className="border border-ink-soft/40 bg-paper p-3">
              <p className="label-mono mb-1 truncate">{TEAM_LABEL[tm]}</p>
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
            </div>
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

function effectiveStatuses(
  workspace: string,
  tasks: Task[],
  autoMap: Record<string, AutoStatus>,
): Record<string, Status> {
  const out: Record<string, Status> = {};
  for (const t of tasks) {
    let s: Status;
    try {
      const raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(`worklist:${workspace}:${t.id}`)
          : null;
      if (raw) {
        const parsed = JSON.parse(raw) as { status: Status };
        s = parsed.status;
      } else {
        const a = autoMap[t.id] ?? "unknown";
        s = a === "unknown" ? "not_started" : a;
      }
    } catch {
      const a = autoMap[t.id] ?? "unknown";
      s = a === "unknown" ? "not_started" : a;
    }
    out[t.id] = s;
  }
  return out;
}

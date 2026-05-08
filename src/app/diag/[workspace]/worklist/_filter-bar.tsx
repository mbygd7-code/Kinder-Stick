"use client";

import { useEffect, useState } from "react";
import {
  PHASE_LABEL,
  PHASE_ORDER,
  TEAM_LABEL,
  TEAM_ORDER,
  type FunnelStage,
  type Phase,
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

type StatusFilter = "all" | "incomplete" | "in_progress" | "must_only";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: "전체",
  incomplete: "미완료만",
  in_progress: "진행중만",
  must_only: "필수만",
};

export function FilterBar({ workspace, tasks, autoMap }: Props) {
  const [team, setTeam] = useState<Team | "all">("all");
  const [phase, setPhase] = useState<Phase | "all">("all");
  const [funnel, setFunnel] = useState<FunnelStage | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    const funnelHandler = (e: Event) => {
      const ce = e as CustomEvent<{ active: FunnelStage | "all" }>;
      setFunnel(ce.detail.active);
    };
    window.addEventListener("worklist:change", handler);
    window.addEventListener("storage", handler);
    window.addEventListener("worklist:funnel", funnelHandler);
    return () => {
      window.removeEventListener("worklist:change", handler);
      window.removeEventListener("storage", handler);
      window.removeEventListener("worklist:funnel", funnelHandler);
    };
  }, []);

  // Apply filter via data attributes
  useEffect(() => {
    const rows = document.querySelectorAll<HTMLElement>("[data-task-id]");
    rows.forEach((row) => {
      const t = row.dataset.team as Team;
      const p = row.dataset.phase as Phase;
      const f = row.dataset.funnel as FunnelStage | undefined;
      const tier = row.dataset.tier as string;
      const id = row.dataset.taskId as string;
      // compute status
      let status: Status = "not_started";
      try {
        const raw = window.localStorage.getItem(`worklist:${workspace}:${id}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { status: Status };
          status = parsed.status;
        } else {
          const a = autoMap[id] ?? "unknown";
          status = a === "unknown" ? "not_started" : a;
        }
      } catch {
        // fallback
      }
      row.dataset.status = status;

      let visible = true;
      if (team !== "all" && t !== team) visible = false;
      if (phase !== "all" && p !== phase) visible = false;
      if (funnel !== "all" && f !== funnel) visible = false;
      if (statusFilter === "must_only" && tier !== "must") visible = false;
      if (statusFilter === "incomplete" && status === "done") visible = false;
      if (statusFilter === "in_progress" && status !== "in_progress")
        visible = false;
      row.style.display = visible ? "" : "none";
    });

    // hide phase blocks with no visible rows
    document
      .querySelectorAll<HTMLElement>("[data-phase-block]")
      .forEach((block) => {
        const visibleRows = block.querySelectorAll<HTMLElement>(
          "[data-task-id]:not([style*='display: none'])",
        );
        block.style.display = visibleRows.length > 0 ? "" : "none";
      });

    // hide team sections with no visible blocks
    document
      .querySelectorAll<HTMLElement>("[data-team-section]")
      .forEach((sec) => {
        const teamCode = sec.dataset.teamSection as Team;
        if (team !== "all" && teamCode !== team) {
          sec.style.display = "none";
          return;
        }
        const visibleBlocks = sec.querySelectorAll<HTMLElement>(
          "[data-phase-block]:not([style*='display: none'])",
        );
        sec.style.display = visibleBlocks.length > 0 ? "" : "none";
      });

    void tick;
  }, [team, phase, funnel, statusFilter, autoMap, workspace, tick, tasks]);

  const teamCounts = countByTeam(tasks);
  const phaseCounts = countByPhase(tasks);

  return (
    <div className="border-2 border-ink bg-paper p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="kicker">필터</p>
        <p className="label-mono">팀·단계·상태로 빠르게 좁힙니다.</p>
      </div>

      {/* Team chips */}
      <div className="mt-3">
        <p className="label-mono mb-1.5">팀</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            small
            active={team === "all"}
            onClick={() => setTeam("all")}
            label={`전체 ${tasks.length}`}
          />
          {TEAM_ORDER.map((t) => (
            <Chip
              key={t}
              small
              active={team === t}
              onClick={() => setTeam(t)}
              label={`${TEAM_LABEL[t].split(" ")[0]} ${teamCounts[t]}`}
            />
          ))}
        </div>
      </div>

      {/* Phase chips */}
      <div className="mt-3 pt-3 border-t border-ink-soft/30">
        <p className="label-mono mb-1.5">라이프사이클 단계</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            small
            active={phase === "all"}
            onClick={() => setPhase("all")}
            label={`전체 ${tasks.length}`}
          />
          {PHASE_ORDER.map((p) => (
            <Chip
              key={p}
              small
              active={phase === p}
              onClick={() => setPhase(p)}
              label={`${PHASE_LABEL[p]} ${phaseCounts[p]}`}
            />
          ))}
        </div>
      </div>

      {/* Status chips */}
      <div className="mt-3 pt-3 border-t border-ink-soft/30">
        <p className="label-mono mb-1.5">상태</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((s) => (
            <Chip
              key={s}
              small
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              label={STATUS_FILTER_LABEL[s]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function countByTeam(tasks: Task[]): Record<Team, number> {
  const out: Record<Team, number> = {
    director: 0,
    planning: 0,
    design: 0,
    engineering: 0,
    operations: 0,
    marketing: 0,
  };
  for (const t of tasks) out[t.team] += 1;
  return out;
}

function countByPhase(tasks: Task[]): Record<Phase, number> {
  const out: Record<Phase, number> = {
    foundation: 0,
    launch: 0,
    growth: 0,
    ops: 0,
  };
  for (const t of tasks) out[t.phase] += 1;
  return out;
}

function Chip({
  active,
  onClick,
  label,
  small,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"} font-medium tracking-tight border-2 transition-colors ${
        active
          ? "bg-ink text-paper border-ink"
          : "bg-paper text-ink-soft border-ink-soft/40 hover:border-ink hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

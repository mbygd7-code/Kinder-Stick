"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * 검색·필터 바 — 업무 리스트 바로 위에 위치.
 *
 * 기본: slim search bar — 돋보기 아이콘 + 텍스트 입력 + 활성 필터 칩.
 * 돋보기 클릭 → expanded 패널이 펼쳐지며 팀·단계·상태 필터 칩을 노출.
 * 활성 필터가 1개 이상이면 자동으로 펼쳐진다.
 */
export function SearchFilterBar({ workspace, tasks, autoMap }: Props) {
  const [team, setTeam] = useState<Team | "all">("all");
  const [phase, setPhase] = useState<Phase | "all">("all");
  const [funnel, setFunnel] = useState<FunnelStage | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 패널 닫기 — 활성 필터가 있어도 패널은 닫고 칩만 유지.
  // ESC 키도 동일하게 닫기.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current && containerRef.current.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // mousedown 이 click 보다 빨라 panel 안 버튼 클릭과의 race condition 회피
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // funnel-ribbon click event 동기화
  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    const funnelHandler = (e: Event) => {
      const ce = e as CustomEvent<{ active: FunnelStage | "all" }>;
      setFunnel(ce.detail.active);
      if (ce.detail.active !== "all") setOpen(true);
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

  // 활성 필터 자동 펼침 — 사용자가 텍스트 검색을 시작했거나, 어떤 필터든 선택됐을 때
  const hasActiveFilter =
    team !== "all" ||
    phase !== "all" ||
    funnel !== "all" ||
    statusFilter !== "all" ||
    query.trim().length > 0;

  // Apply filter via data attributes (matches existing FilterBar behavior)
  useEffect(() => {
    const q = query.trim().toLowerCase();
    const rows = document.querySelectorAll<HTMLElement>("[data-task-id]");
    rows.forEach((row) => {
      const t = row.dataset.team as Team;
      const p = row.dataset.phase as Phase;
      const f = row.dataset.funnel as FunnelStage | undefined;
      const tier = row.dataset.tier as string;
      const id = row.dataset.taskId as string;
      const titleEl = row.querySelector<HTMLElement>(
        "[data-task-title], h4, h3",
      );
      const taskTitle = (
        titleEl?.textContent ?? row.textContent ?? ""
      ).toLowerCase();

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
      if (q && !taskTitle.includes(q)) visible = false;

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
  }, [team, phase, funnel, statusFilter, query, autoMap, workspace, tick, tasks]);

  const teamCounts = useMemo(() => countByTeam(tasks), [tasks]);
  const phaseCounts = useMemo(() => countByPhase(tasks), [tasks]);

  // 활성 필터 카운트 (배지용)
  const activeCount =
    (team !== "all" ? 1 : 0) +
    (phase !== "all" ? 1 : 0) +
    (funnel !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (query.trim() ? 1 : 0);

  const clearAll = () => {
    setTeam("all");
    setPhase("all");
    setFunnel("all");
    setStatusFilter("all");
    setQuery("");
  };

  return (
    <div ref={containerRef} className="border-y-2 border-ink bg-paper">
      {/* SLIM BAR — always visible. 돋보기 + 텍스트 인풋 + 활성 필터 + toggle */}
      <div className="flex items-stretch divide-x divide-ink-soft/30">
        {/* 돋보기 토글 */}
        <button
          type="button"
          onClick={() => {
            setOpen((v) => {
              const next = !v;
              if (next) {
                // open 시 검색 인풋에 자동 focus
                setTimeout(() => inputRef.current?.focus(), 50);
              }
              return next;
            });
          }}
          className={`shrink-0 px-4 sm:px-5 flex items-center gap-2 transition-colors ${
            open || hasActiveFilter
              ? "bg-ink text-paper"
              : "hover:bg-paper-deep/40 text-ink-soft hover:text-ink"
          }`}
          aria-label={open ? "필터 닫기" : "검색·필터 열기"}
          aria-expanded={open}
        >
          {/* 돋보기 아이콘 */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <span className="text-sm font-medium">
            {open ? "닫기" : "검색·필터"}
          </span>
          {activeCount > 0 ? (
            <span
              className={`font-mono text-[10px] px-1.5 py-0.5 ${
                open || hasActiveFilter
                  ? "bg-paper text-ink"
                  : "bg-accent text-paper"
              }`}
            >
              {activeCount}
            </span>
          ) : null}
        </button>

        {/* 텍스트 검색 인풋 — 항상 보이지만, 모바일에선 좁아짐 */}
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="업무 제목으로 검색…"
          className="flex-1 min-w-0 px-4 py-3 bg-transparent text-sm focus:outline-none focus:bg-paper-soft placeholder:text-ink-soft/60"
          aria-label="업무 검색"
        />

        {/* 활성 필터 칩 (slim) — open 이 false 일 때만 inline 으로 노출 */}
        {!open && hasActiveFilter ? (
          <div className="hidden sm:flex items-center gap-1.5 px-3 shrink-0 overflow-x-auto max-w-[40%]">
            {team !== "all" ? (
              <ActiveChip
                label={TEAM_LABEL[team].split(" ")[0]}
                onClear={() => setTeam("all")}
              />
            ) : null}
            {phase !== "all" ? (
              <ActiveChip
                label={PHASE_LABEL[phase]}
                onClear={() => setPhase("all")}
              />
            ) : null}
            {statusFilter !== "all" ? (
              <ActiveChip
                label={STATUS_FILTER_LABEL[statusFilter]}
                onClear={() => setStatusFilter("all")}
              />
            ) : null}
            {funnel !== "all" ? (
              <ActiveChip
                label={funnel}
                onClear={() => setFunnel("all")}
              />
            ) : null}
          </div>
        ) : null}

        {/* 전체 해제 — 활성 필터가 있을 때만 */}
        {hasActiveFilter ? (
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 px-4 label-mono hover:text-ink hover:bg-paper-deep/40"
            title="모든 필터 해제"
          >
            지우기
          </button>
        ) : null}
      </div>

      {/* EXPANDED PANEL — 돋보기 클릭 시 펼쳐짐 */}
      {open ? (
        <div className="border-t border-ink-soft/30 bg-paper-soft/40 p-4 sm:p-5 space-y-4">
          {/* Team chips */}
          <div>
            <p className="label-mono mb-2">팀</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                active={team === "all"}
                onClick={() => setTeam("all")}
                label={`전체 ${tasks.length}`}
              />
              {TEAM_ORDER.map((t) => (
                <Chip
                  key={t}
                  active={team === t}
                  onClick={() => setTeam(t)}
                  label={`${TEAM_LABEL[t].split(" ")[0]} ${teamCounts[t]}`}
                />
              ))}
            </div>
          </div>

          {/* Phase chips */}
          <div>
            <p className="label-mono mb-2">라이프사이클 단계</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                active={phase === "all"}
                onClick={() => setPhase("all")}
                label={`전체 ${tasks.length}`}
              />
              {PHASE_ORDER.map((p) => (
                <Chip
                  key={p}
                  active={phase === p}
                  onClick={() => setPhase(p)}
                  label={`${PHASE_LABEL[p]} ${phaseCounts[p]}`}
                />
              ))}
            </div>
          </div>

          {/* Status chips */}
          <div>
            <p className="label-mono mb-2">상태</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((s) => (
                <Chip
                  key={s}
                  active={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                  label={STATUS_FILTER_LABEL[s]}
                />
              ))}
            </div>
          </div>

          {/* Funnel — funnel ribbon 이 있는 경우 함께 보이도록 */}
          {funnel !== "all" ? (
            <div>
              <p className="label-mono mb-2">고객여정 단계</p>
              <Chip
                active
                onClick={() => setFunnel("all")}
                label={`${funnel} (해제하려면 클릭)`}
              />
            </div>
          ) : null}
        </div>
      ) : null}
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium tracking-tight border-2 transition-colors ${
        active
          ? "bg-ink text-paper border-ink"
          : "bg-paper text-ink-soft border-ink-soft/40 hover:border-ink hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function ActiveChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-accent text-paper hover:bg-ink whitespace-nowrap"
      title={`${label} 필터 해제`}
    >
      <span>{label}</span>
      <span className="font-mono text-xs">×</span>
    </button>
  );
}

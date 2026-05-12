"use client";

import { useEffect, useState, useCallback } from "react";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  type Status,
} from "@/lib/worklist/catalog";
import type { AutoStatus } from "@/lib/worklist/derive";
import { readKpiProgress } from "./_task-kpi-checklist";

interface Props {
  workspace: string;
  taskId: string;
  autoStatus: AutoStatus; // server-derived; "unknown" for manual_only
}

interface OverrideEntry {
  status: Status;
  ts: number;
}

function key(workspace: string, taskId: string) {
  return `worklist:${workspace}:${taskId}`;
}

function readOverride(
  workspace: string,
  taskId: string,
): OverrideEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(workspace, taskId));
    if (!raw) return null;
    return JSON.parse(raw) as OverrideEntry;
  } catch {
    return null;
  }
}

function writeOverride(
  workspace: string,
  taskId: string,
  status: Status,
): void {
  if (typeof window === "undefined") return;
  const entry: OverrideEntry = { status, ts: Date.now() };
  window.localStorage.setItem(key(workspace, taskId), JSON.stringify(entry));
  window.dispatchEvent(
    new CustomEvent("worklist:change", {
      detail: { workspace, taskId, status },
    }),
  );
}

function clearOverride(workspace: string, taskId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(workspace, taskId));
  window.dispatchEvent(
    new CustomEvent("worklist:change", {
      detail: { workspace, taskId, status: null },
    }),
  );
}

const STATUS_TONE: Record<Status, string> = {
  not_started: "bg-paper-deep text-ink-soft border-ink-soft/40",
  scheduled: "bg-soft-cobalt text-cobalt border-cobalt/50",
  in_progress: "bg-soft-amber text-amber border-amber/60",
  done: "bg-green text-paper border-green",
};

export function StatusPill({ workspace, taskId, autoStatus }: Props) {
  const [override, setOverride] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [kpiProgress, setKpiProgress] = useState<{
    checked: number;
    total: number;
    percent: number;
  } | null>(null);

  // Load override on mount + listen to cross-component changes
  useEffect(() => {
    setMounted(true);
    const refresh = () => {
      const ov = readOverride(workspace, taskId);
      setOverride(ov?.status ?? null);
      setKpiProgress(readKpiProgress(workspace, taskId));
    };
    refresh();

    const handler = (e: Event) => {
      const ce = e as CustomEvent<{
        workspace: string;
        taskId: string;
        status?: Status | null;
        kpi?: boolean;
      }>;
      // Refresh on any change for this task (status or kpi)
      if (
        ce.detail?.workspace === workspace &&
        ce.detail?.taskId === taskId
      ) {
        refresh();
      } else if (!ce.detail) {
        refresh();
      }
    };
    window.addEventListener("worklist:change", handler);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("worklist:change", handler);
      window.removeEventListener("storage", refresh);
    };
  }, [workspace, taskId]);

  // KPI-derived status takes effect ONLY if user hasn't manually overridden.
  // Manual override always wins so the user can mark "done" even before
  // checking all KPIs, or stay "not started" even with KPIs checked.
  const kpiDerived: Status | null = (() => {
    if (!kpiProgress || kpiProgress.total === 0) return null;
    if (kpiProgress.percent === 100) return "done";
    if (kpiProgress.checked > 0) return "in_progress";
    return null;
  })();

  const effective: Status =
    override ??
    kpiDerived ??
    (autoStatus === "unknown" ? "not_started" : autoStatus);
  const isOverridden = override !== null;
  const isFromKpi = override === null && kpiDerived !== null;

  const handleSelect = useCallback(
    (s: Status) => {
      // If selecting matches the auto status (and it's not unknown), clear override
      if (autoStatus !== "unknown" && s === autoStatus) {
        clearOverride(workspace, taskId);
        setOverride(null);
      } else {
        writeOverride(workspace, taskId, s);
        setOverride(s);
      }
      setOpen(false);
    },
    [workspace, taskId, autoStatus],
  );

  // SSR-safe initial paint: while not mounted, show derived status only
  const display: Status = mounted ? effective : effective;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`px-2.5 py-1.5 text-xs font-semibold border tracking-tight transition-all ${STATUS_TONE[display]} ${
          open ? "ring-2 ring-ink/30" : ""
        }`}
        aria-label={`상태: ${STATUS_LABEL[display]}${
          isFromKpi && kpiProgress ? ` · ${kpiProgress.percent}%` : ""
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              display === "done"
                ? "bg-paper"
                : display === "in_progress"
                  ? "bg-amber"
                  : display === "scheduled"
                    ? "bg-cobalt"
                    : "bg-ink-soft"
            }`}
          />
          <span className="font-display">{STATUS_LABEL[display]}</span>
          {isFromKpi && kpiProgress && display === "in_progress" ? (
            <span className="font-mono text-[10px] font-bold tabular-nums">
              {kpiProgress.percent}%
            </span>
          ) : null}
          {isOverridden ? (
            <span className="font-mono text-[10px] opacity-70">·수동</span>
          ) : isFromKpi ? (
            <span className="font-mono text-[10px] opacity-70">·KPI</span>
          ) : autoStatus === "unknown" ? null : (
            <span className="font-mono text-[10px] opacity-60">·자동</span>
          )}
        </span>
      </button>

      {open ? (
        <>
          {/* backdrop */}
          <button
            type="button"
            aria-label="닫기"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute z-50 mt-1 right-0 min-w-[140px] border-2 border-ink bg-paper shadow-lg"
          >
            {STATUS_ORDER.map((s) => {
              const isAuto = autoStatus !== "unknown" && s === autoStatus;
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => handleSelect(s)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-paper-deep flex items-center justify-between gap-2 ${
                      s === display ? "bg-paper-soft" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          s === "done"
                            ? "bg-green"
                            : s === "in_progress"
                              ? "bg-amber"
                              : s === "scheduled"
                                ? "bg-cobalt"
                                : "bg-ink-soft"
                        }`}
                      />
                      <span className="font-medium">{STATUS_LABEL[s]}</span>
                    </span>
                    {isAuto ? (
                      <span className="label-mono">자동값</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {isOverridden ? (
              <li className="border-t border-ink-soft/40">
                <button
                  type="button"
                  onClick={() => {
                    clearOverride(workspace, taskId);
                    setOverride(null);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-paper-deep label-mono"
                >
                  ↺ 자동값으로 되돌리기
                </button>
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * Lightweight summary aggregator used by the header progress bar.
 * Reads from localStorage and merges with auto statuses.
 */
export function useEffectiveStatuses(
  workspace: string,
  taskIds: string[],
  autoMap: Record<string, AutoStatus>,
): Record<string, Status> {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("worklist:change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("worklist:change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const out: Record<string, Status> = {};
  for (const id of taskIds) {
    const ov = readOverride(workspace, id);
    if (ov) {
      out[id] = ov.status;
      continue;
    }
    const auto = autoMap[id] ?? "unknown";
    out[id] = auto === "unknown" ? "not_started" : auto;
  }
  // tick is consumed via render; suppress unused warning
  void tick;
  return out;
}

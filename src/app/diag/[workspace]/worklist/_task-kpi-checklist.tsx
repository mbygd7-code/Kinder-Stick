"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "@/lib/worklist/catalog";
import { Emphasize } from "./_emphasize";

/* ------------------------------------------------------------------
 * Storage shape:
 *   worklist:playbook:v4:{taskId}                  → PlaybookData (AI 생성)
 *   worklist:{workspace}:{taskId}:kpis             → { checked: number[] }
 *
 *   체크 상태가 바뀌면 `worklist:kpi-change` + `worklist:change` 모두 발행.
 *   StatusPill 이 후자를 듣고 자동으로 % 갱신.
 * ------------------------------------------------------------------ */

const PLAYBOOK_KEY = (taskId: string) => `worklist:playbook:v4:${taskId}`;
const KPI_KEY = (ws: string, taskId: string) =>
  `worklist:${ws}:${taskId}:kpis`;

interface PlaybookLite {
  kpis: Array<{ name: string; threshold: string; method: string }>;
}

interface KpiCheckState {
  checked: number[];
}

function loadPlaybookKpis(taskId: string): PlaybookLite["kpis"] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PLAYBOOK_KEY(taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kpis?: PlaybookLite["kpis"] };
    return Array.isArray(parsed.kpis) ? parsed.kpis : null;
  } catch {
    return null;
  }
}

function loadKpiChecks(workspace: string, taskId: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KPI_KEY(workspace, taskId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as KpiCheckState;
    return Array.isArray(parsed.checked) ? parsed.checked : [];
  } catch {
    return [];
  }
}

function saveKpiChecks(
  workspace: string,
  taskId: string,
  checked: number[],
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    KPI_KEY(workspace, taskId),
    JSON.stringify({ checked }),
  );
  window.dispatchEvent(
    new CustomEvent("worklist:change", {
      detail: { workspace, taskId, kpi: true },
    }),
  );
}

/**
 * 외부에서 (StatusPill 등) KPI 진행률을 가져갈 수 있도록 export.
 * total > 0 이면 percent 계산 가능, 0 이면 KPI 체크 기능 미사용 상태.
 */
export function readKpiProgress(
  workspace: string,
  taskId: string,
): { checked: number; total: number; percent: number } | null {
  const kpis = loadPlaybookKpis(taskId);
  if (!kpis || kpis.length === 0) return null;
  const checks = loadKpiChecks(workspace, taskId);
  const validChecked = checks.filter((i) => i >= 0 && i < kpis.length).length;
  return {
    checked: validChecked,
    total: kpis.length,
    percent: Math.round((validChecked / kpis.length) * 100),
  };
}

// ============================================================
// Component
// ============================================================

interface Props {
  task: Task;
  workspace: string;
}

export function TaskKpiChecklist({ task, workspace }: Props) {
  const [kpis, setKpis] = useState<PlaybookLite["kpis"]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const refresh = () => {
      const k = loadPlaybookKpis(task.id) ?? [];
      setKpis(k);
      const c = loadKpiChecks(workspace, task.id);
      setChecked(new Set(c));
    };
    refresh();
    // 다른 컴포넌트(특히 playbook popover, bulk generator)가 KPI를 새로 만들면 알림.
    // taskId 매칭 — 다른 카드의 변경은 무시해서 138개 동시 재렌더를 방지.
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ taskId?: string }>;
      const tid = ce.detail?.taskId;
      // detail 이 없는 이벤트는 (호환성) 일단 무시 — 진짜 갱신은 detail 필수
      if (tid && tid !== task.id) return;
      if (!tid) return;
      refresh();
    };
    window.addEventListener("worklist:change", handler);
    return () => {
      window.removeEventListener("worklist:change", handler);
    };
  }, [task.id, workspace]);

  // Close on outside click + Esc
  useEffect(() => {
    if (!open) return;
    function mouseHandler(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    }
    function escHandler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", mouseHandler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", mouseHandler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open]);

  const total = kpis.length;
  const checkedCount = useMemo(
    () => Array.from(checked).filter((i) => i >= 0 && i < total).length,
    [checked, total],
  );
  const percent = total > 0 ? Math.round((checkedCount / total) * 100) : 0;

  const toggle = useCallback(
    (idx: number) => {
      const next = new Set(checked);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      setChecked(next);
      saveKpiChecks(workspace, task.id, Array.from(next));
    },
    [checked, workspace, task.id],
  );

  if (!mounted) return null;

  // 플레이북이 없으면 아무것도 노출하지 않음 (popover에서 생성 유도)
  if (total === 0) return null;

  return (
    <div
      ref={containerRef}
      className="border-t border-ink-soft/30 bg-paper-deep"
    >
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-paper-soft transition-colors text-left"
        aria-expanded={open}
        aria-label="검증 KPI 체크리스트 펼치기"
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="t-label-ink">검증 KPI</span>
          <span className="t-body-sm">
            <strong className="font-semibold text-ink t-num">
              {checkedCount}
            </strong>
            <span className="text-ink-soft"> / {total} 체크</span>
          </span>
          {/* progress mini-bar */}
          <span className="inline-block h-1.5 w-24 bg-ink-soft/20 align-middle overflow-hidden">
            <span
              className={`block h-full transition-all ${
                percent === 100
                  ? "bg-green"
                  : percent > 0
                    ? "bg-amber"
                    : "bg-ink-soft/40"
              }`}
              style={{ width: `${percent}%` }}
            />
          </span>
          <span className="t-label t-num">{percent}%</span>
        </div>
        <span
          className={`t-label-ink transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {open ? (
        <ul className="px-4 sm:px-5 py-4 space-y-3 border-t border-ink-soft/20">
          {kpis.map((k, i) => {
            const isChecked = checked.has(i);
            return (
              <li
                key={i}
                className={`grid grid-cols-[auto_1fr] gap-3 px-3 py-3 border-2 transition-colors ${
                  isChecked
                    ? "border-green/60 bg-soft-green/30"
                    : "border-ink-soft/30 bg-paper hover:border-ink/40"
                }`}
              >
                <label className="flex items-start cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(i)}
                    className="w-5 h-5 cursor-pointer accent-green"
                    aria-label={`${k.name} 체크`}
                  />
                </label>
                <label
                  className="cursor-pointer min-w-0"
                  onClick={() => toggle(i)}
                >
                  <p
                    className={`t-display-4 text-ink ${
                      isChecked ? "line-through decoration-2 text-ink/60" : ""
                    }`}
                  >
                    {k.name}
                  </p>
                  <p className="t-body-sm mt-1.5">
                    <span className="t-label mr-1.5 align-middle">목표</span>
                    <strong className="font-semibold text-accent">
                      <Emphasize text={k.threshold} />
                    </strong>
                  </p>
                  {k.method ? (
                    <p className="t-meta mt-1">
                      <span className="t-label mr-1.5 align-middle">측정</span>
                      <Emphasize text={k.method} />
                    </p>
                  ) : null}
                </label>
              </li>
            );
          })}
          <p className="t-label pt-2">
            모든 KPI를 체크하면 자동으로 완료 상태로 전환됩니다.
          </p>
        </ul>
      ) : null}
    </div>
  );
}

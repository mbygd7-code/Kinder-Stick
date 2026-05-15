"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "@/lib/worklist/catalog";
import { loadPlaybook } from "@/lib/worklist/playbook-cache";
import { Emphasize } from "./_emphasize";

/* ------------------------------------------------------------------
 * Storage shape:
 *   worklist:playbook:v5:{taskId}:{taskHash}       → PlaybookData (AI 생성, content-hashed)
 *   worklist:{workspace}:{taskId}:kpis             → { checked: number[] }
 *
 *   체크 상태가 바뀌면:
 *     1) localStorage 즉시 저장 (instant)
 *     2) Supabase 비동기 업로드 (팀 공유, fire-and-forget)
 *     3) `worklist:change` 발행 → StatusPill 이 자동 % 갱신.
 *
 *   페이지 mount 시 hydrateKpiChecksFromShared() 가 Supabase → localStorage
 *   재시드 → 다른 기기·다른 멤버의 체크가 즉시 반영.
 * ------------------------------------------------------------------ */

const KPI_KEY = (ws: string, taskId: string) =>
  `worklist:${ws}:${taskId}:kpis`;

interface PlaybookLite {
  kpis: Array<{ name: string; threshold: string; method: string }>;
}

interface KpiCheckState {
  checked: number[];
}

function loadPlaybookKpis(task: Task): PlaybookLite["kpis"] | null {
  // 새 캐시 모듈(playbook-cache.ts)은 task content hash 를 cache key 에 포함 →
  // task 객체 전체를 받아 hash 매칭으로 정확한 cache slot 을 찾는다.
  const data = loadPlaybook(task);
  if (!data) return null;
  return Array.isArray(data.kpis) ? data.kpis : null;
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
  // Supabase 공유 캐시 — fire-and-forget. 실패해도 localStorage 는 이미 저장됨.
  void uploadKpiChecksToShared(workspace, taskId, checked);
}

/**
 * Supabase 의 kso_worklist_kpi_checks 테이블에 upsert.
 * - PIN 세션이 없거나 Supabase 미설정이면 graceful no-op (서버가 200 + shared:false 반환)
 * - 네트워크 오류 시 silent — UX 차단 금지
 */
async function uploadKpiChecksToShared(
  workspace: string,
  taskId: string,
  checked: number[],
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/worklist/kpi-checks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace, task_id: taskId, checked }),
      // bulk 자동 생성 등으로 다수 동시 호출 시에도 keepalive 로 페이지 unload 견딤
      keepalive: true,
    });
  } catch {
    // 무시 — localStorage 는 이미 안전하게 저장됨
  }
}

/**
 * 워크리스트 페이지 mount 시 1회 호출.
 * Supabase 의 모든 KPI 체크를 fetch → localStorage 시드.
 * - 다른 기기/시크릿 모드에서도 진행 상태 복원
 * - 같은 팀 다른 멤버의 체크가 즉시 반영
 *
 * 정책:
 *  - 항상 Supabase 가 truth-of-source — 로컬 값을 덮어씀.
 *  - 단, Supabase entry 가 없는 task 는 로컬 값을 그대로 유지 (오프라인 보호).
 *  - hydrate 후 worklist:change 한 번 발행 → StatusPill, 카드들이 자동 갱신.
 *
 * 반환: { hydrated: number, total: number, shared: bool }
 */
export async function hydrateKpiChecksFromShared(
  workspace: string,
): Promise<{ hydrated: number; total: number; shared: boolean }> {
  if (typeof window === "undefined") {
    return { hydrated: 0, total: 0, shared: false };
  }
  let res: Response;
  try {
    res = await fetch(
      `/api/worklist/kpi-checks?workspace=${encodeURIComponent(workspace)}`,
      { method: "GET" },
    );
  } catch {
    return { hydrated: 0, total: 0, shared: false };
  }
  if (!res.ok) return { hydrated: 0, total: 0, shared: false };
  let body: { entries?: Array<{ task_id: string; checked: number[] }>; shared?: boolean };
  try {
    body = await res.json();
  } catch {
    return { hydrated: 0, total: 0, shared: false };
  }
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const total = entries.length;
  let hydrated = 0;
  for (const e of entries) {
    if (!e.task_id || !Array.isArray(e.checked)) continue;
    const sanitized = e.checked.filter(
      (i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0,
    );
    try {
      window.localStorage.setItem(
        KPI_KEY(workspace, e.task_id),
        JSON.stringify({ checked: sanitized }),
      );
      hydrated++;
    } catch {
      // quota exceeded 등 — 무시
    }
  }
  if (hydrated > 0) {
    // detail.taskId 없음 → 모든 카드의 KPI 체크리스트가 1회 refresh
    // (handler 가 detail 없는 이벤트는 무시하므로, 의도적으로 hydrate 전용 신호 추가)
    window.dispatchEvent(
      new CustomEvent("worklist:change", {
        detail: { workspace, kpi: true, source: "kpi-hydrate" },
      }),
    );
  }
  return { hydrated, total, shared: !!body.shared };
}

/**
 * 외부에서 (StatusPill 등) KPI 진행률을 가져갈 수 있도록 export.
 * total > 0 이면 percent 계산 가능, 0 이면 KPI 체크 기능 미사용 상태.
 *
 * 시그니처: 새 캐시는 task content hash 가 필요하므로 Task 객체 전체를 받는다.
 */
export function readKpiProgress(
  workspace: string,
  task: Task,
): { checked: number; total: number; percent: number } | null {
  const kpis = loadPlaybookKpis(task);
  if (!kpis || kpis.length === 0) return null;
  const checks = loadKpiChecks(workspace, task.id);
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
      const k = loadPlaybookKpis(task) ?? [];
      setKpis(k);
      const c = loadKpiChecks(workspace, task.id);
      setChecked(new Set(c));
    };
    refresh();
    // 다른 컴포넌트(특히 playbook popover, bulk generator)가 KPI를 새로 만들면 알림.
    // taskId 매칭 — 다른 카드의 변경은 무시해서 138개 동시 재렌더를 방지.
    // 단, source === "kpi-hydrate" 는 워크스페이스 전체 hydrate 신호 →
    // taskId 없어도 모든 카드 refresh 필요.
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ taskId?: string; source?: string }>;
      const tid = ce.detail?.taskId;
      const src = ce.detail?.source;
      if (src === "kpi-hydrate") {
        refresh();
        return;
      }
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

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Task } from "@/lib/worklist/catalog";

interface CustomEntry {
  title: string;
  ts: number;
}

function key(workspace: string, taskId: string): string {
  return `worklist:${workspace}:${taskId}:custom`;
}

function readCustom(workspace: string, taskId: string): CustomEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(workspace, taskId));
    if (!raw) return null;
    return JSON.parse(raw) as CustomEntry;
  } catch {
    return null;
  }
}

function writeCustom(
  workspace: string,
  taskId: string,
  title: string,
): void {
  if (typeof window === "undefined") return;
  const entry: CustomEntry = { title, ts: Date.now() };
  window.localStorage.setItem(key(workspace, taskId), JSON.stringify(entry));
  window.dispatchEvent(
    new CustomEvent("worklist:custom-title", {
      detail: { workspace, taskId, title },
    }),
  );
}

function clearCustom(workspace: string, taskId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(workspace, taskId));
  window.dispatchEvent(
    new CustomEvent("worklist:custom-title", {
      detail: { workspace, taskId, title: null },
    }),
  );
}

function useCustomTitle(workspace: string, taskId: string) {
  const [custom, setCustom] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const c = readCustom(workspace, taskId);
    setCustom(c?.title ?? null);

    const handler = (e: Event) => {
      const ce = e as CustomEvent<{
        workspace: string;
        taskId: string;
        title: string | null;
      }>;
      if (ce.detail.workspace === workspace && ce.detail.taskId === taskId) {
        setCustom(ce.detail.title);
      }
    };
    window.addEventListener("worklist:custom-title", handler);
    return () => window.removeEventListener("worklist:custom-title", handler);
  }, [workspace, taskId]);

  return { custom, mounted, setCustom };
}

// ============================================================
// TaskTitle — title display only (no edit button)
// ============================================================

export function TaskTitle({
  workspace,
  task,
}: {
  workspace: string;
  task: Task;
}) {
  const { custom, mounted } = useCustomTitle(workspace, task.id);

  const displayTitle = mounted ? (custom ?? task.title) : task.title;
  const hasCustom = mounted && custom !== null && custom !== task.title;

  return (
    <p
      data-task-title
      className="t-display-3 sm:t-display-2 text-ink break-keep"
    >
      {displayTitle}
      {hasCustom ? (
        <span className="ml-2 align-middle inline-block tag tag-gold">
          수정됨
        </span>
      ) : null}
    </p>
  );
}

// ============================================================
// TaskEditButton — ✎ icon + edit popover (similar suggestions + AI rewrite)
// ============================================================

export function TaskEditButton({
  workspace,
  task,
}: {
  workspace: string;
  task: Task;
}) {
  const { custom, mounted, setCustom } = useCustomTitle(workspace, task.id);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);
  const [derivatives, setDerivatives] = useState<string[]>([]);
  const [derivBusy, setDerivBusy] = useState(false);
  const [derivError, setDerivError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const startEdit = useCallback(() => {
    setDraft(custom ?? task.title);
    setOpen(true);
  }, [custom, task.title]);

  const saveDraft = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed === task.title) {
      clearCustom(workspace, task.id);
      setCustom(null);
    } else {
      writeCustom(workspace, task.id, trimmed);
      setCustom(trimmed);
    }
    setOpen(false);
  }, [draft, task.id, task.title, workspace, setCustom]);

  const pickDerivative = useCallback(
    (title: string) => {
      writeCustom(workspace, task.id, title);
      setCustom(title);
      setOpen(false);
    },
    [workspace, task.id, setCustom],
  );

  const generateDerivatives = useCallback(async () => {
    setDerivError(null);
    setDerivBusy(true);
    try {
      const r = await fetch("/api/worklist/ai-derivatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original: task.title,
          why: task.why,
          description: task.description,
          team: task.team,
          phase: task.phase,
        }),
      });
      const json = (await r.json()) as {
        derivatives?: string[];
        error?: string;
      };
      if (!r.ok || !json.derivatives) {
        setDerivError(json.error ?? `HTTP ${r.status}`);
        return;
      }
      setDerivatives(json.derivatives);
    } catch (e) {
      setDerivError(e instanceof Error ? e.message : String(e));
    } finally {
      setDerivBusy(false);
    }
  }, [task.title, task.why, task.description, task.team, task.phase]);

  const revert = useCallback(() => {
    clearCustom(workspace, task.id);
    setCustom(null);
    setOpen(false);
  }, [workspace, task.id, setCustom]);

  const aiAssist = useCallback(async () => {
    setAiBusy(true);
    try {
      const r = await fetch("/api/worklist/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original: task.title,
          why: task.why,
          team: task.team,
          phase: task.phase,
          current: draft,
        }),
      });
      if (!r.ok) {
        const fallback = task.title
          .replace(/\(.*?\)/g, "")
          .replace(/—.*$/, "")
          .trim();
        setDraft(`${fallback} (AI 도움 사용 불가 — 직접 편집)`);
        return;
      }
      const json = (await r.json()) as { suggestion?: string };
      if (json.suggestion) setDraft(json.suggestion);
    } catch {
      // network failure — keep current draft
    } finally {
      setAiBusy(false);
    }
  }, [task.title, task.why, task.team, task.phase, draft]);

  // click outside / Esc to close
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

  const hasCustom =
    mounted && custom !== null && custom !== task.title;

  return (
    <div ref={containerRef} className="shrink-0 relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : startEdit())}
        className={`w-6 h-6 flex items-center justify-center rounded-full border transition-colors text-xs font-mono ${
          open
            ? "border-ink bg-ink text-paper"
            : "border-ink-soft/40 text-ink-soft hover:border-ink hover:bg-paper-deep hover:text-ink"
        }`}
        aria-label="업무 수정"
        title="업무 수정"
        aria-expanded={open}
      >
        ✎
      </button>

      {open ? (
        <div className="absolute right-0 top-7 z-30 w-80 sm:w-[28rem] max-h-[28rem] overflow-y-auto p-5 bg-paper border-2 border-ink shadow-lg space-y-4">
          {/* Custom input */}
          <div>
            <p className="kicker mb-1.5">업무 제목 수정</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 font-display text-base bg-paper border-2 border-ink-soft/40 focus:border-ink focus:outline-none resize-none"
              placeholder="우리 팀에 맞게 업무를 수정하세요"
            />
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={saveDraft}
                disabled={!draft.trim()}
                className="px-3 py-1.5 text-sm font-semibold bg-ink text-paper border-2 border-ink hover:bg-accent hover:border-accent disabled:bg-paper-deep disabled:text-ink-soft disabled:border-ink-soft/40 disabled:cursor-not-allowed"
              >
                저장 →
              </button>
              <button
                type="button"
                onClick={aiAssist}
                disabled={aiBusy}
                className="px-3 py-1.5 text-sm font-medium border-2 border-ink-soft/40 hover:border-ink hover:bg-paper-deep disabled:opacity-50"
                title="현재 입력을 AI가 다듬어 줍니다"
              >
                {aiBusy ? "AI 작성 중…" : "AI로 다듬기"}
              </button>
              {hasCustom ? (
                <button
                  type="button"
                  onClick={revert}
                  className="label-mono hover:text-ink ml-auto"
                >
                  ↺ 원래대로
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="label-mono hover:text-ink"
              >
                취소
              </button>
            </div>
          </div>

          {/* AI-generated derivatives — extensions of THIS task, not other tasks */}
          <div className="border-t border-ink-soft/30 pt-3">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className="kicker">이 업무를 더 구체화한 변형</p>
              <button
                type="button"
                onClick={generateDerivatives}
                disabled={derivBusy}
                className="px-2 py-1 text-xs font-medium border border-ink-soft/40 hover:border-ink hover:bg-paper-deep disabled:opacity-50"
                title="이 업무에서 파생된 더 구체적인 변형 3개를 AI가 생성합니다"
              >
                {derivBusy
                  ? "생성 중…"
                  : derivatives.length > 0
                    ? "↻ 다시 생성"
                    : "AI 변형 추천"}
              </button>
            </div>
            {derivError ? (
              <p className="text-xs text-signal-red font-mono mb-2">
                <span className="uppercase tracking-widest mr-1">오류</span> {derivError}
              </p>
            ) : null}
            {derivatives.length > 0 ? (
              <>
                <p className="label-mono mb-1.5">
                  클릭하면 이 업무 제목이 변형으로 교체됩니다
                </p>
                <ul className="space-y-1.5">
                  {derivatives.map((d, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => pickDerivative(d)}
                        className="w-full text-left px-3 py-2 text-sm border border-ink-soft/30 hover:border-ink hover:bg-paper-deep transition-colors leading-snug"
                      >
                        <span className="font-medium">{d}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : !derivBusy && !derivError ? (
              <p className="text-xs text-ink-soft leading-relaxed">
                ‘이 업무’에서 파생된 더 구체적·실행 가능한 변형 3개를 AI가
                생성합니다. 카탈로그의 다른 업무를 추천하지 않으므로 중복이
                생기지 않습니다.
              </p>
            ) : null}
          </div>

          <p className="label-mono pt-2 border-t border-ink-soft/30">
            저장된 수정 제목은 이 진단 카드에만 적용됩니다 (localStorage).
          </p>
        </div>
      ) : null}
    </div>
  );
}

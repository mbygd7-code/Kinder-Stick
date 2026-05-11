/**
 * Worklist localStorage helpers — derived tasks + overrides
 *
 * - 키 prefix: `worklist:${workspace}:` — 기존 status 키와 같은 네임스페이스
 * - 두 개의 추가 슬롯:
 *     `worklist:${ws}:derived`   → DerivedTask[]
 *     `worklist:${ws}:overrides` → TaskOverride[]
 * - 모든 변경은 `worklist:change` 윈도우 이벤트를 발행하여 FunnelRibbon·
 *   ProgressStrip 등 듣는 컴포넌트가 카운트를 다시 계산하게 한다.
 */

import type { DerivedTask, TaskOverride } from "./catalog";

const DERIVED_KEY = (ws: string) => `worklist:${ws}:derived`;
const OVERRIDES_KEY = (ws: string) => `worklist:${ws}:overrides`;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v as T;
  } catch {
    return fallback;
  }
}

export function loadDerived(workspace: string): DerivedTask[] {
  if (typeof window === "undefined") return [];
  return safeParse<DerivedTask[]>(
    window.localStorage.getItem(DERIVED_KEY(workspace)),
    [],
  );
}

export function loadOverrides(workspace: string): TaskOverride[] {
  if (typeof window === "undefined") return [];
  return safeParse<TaskOverride[]>(
    window.localStorage.getItem(OVERRIDES_KEY(workspace)),
    [],
  );
}

function dispatchChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("worklist:change"));
}

export function saveDerived(workspace: string, items: DerivedTask[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DERIVED_KEY(workspace), JSON.stringify(items));
  dispatchChange();
}

export function saveOverrides(
  workspace: string,
  items: TaskOverride[],
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OVERRIDES_KEY(workspace), JSON.stringify(items));
  dispatchChange();
}

/** Append derived tasks (dedup by id) and overrides (latest-wins by task_id). */
export function appendIngestResult(
  workspace: string,
  newDerived: DerivedTask[],
  newOverrides: TaskOverride[],
): void {
  if (typeof window === "undefined") return;
  const existingDerived = loadDerived(workspace);
  const seen = new Set(existingDerived.map((d) => d.id));
  const mergedDerived = [
    ...existingDerived,
    ...newDerived.filter((d) => !seen.has(d.id)),
  ];

  const existingOverrides = loadOverrides(workspace);
  const overrideMap = new Map<string, TaskOverride>();
  for (const o of existingOverrides) overrideMap.set(o.task_id, o);
  for (const o of newOverrides) overrideMap.set(o.task_id, o);
  const mergedOverrides = Array.from(overrideMap.values());

  // Persist both, but only dispatch change once.
  window.localStorage.setItem(
    DERIVED_KEY(workspace),
    JSON.stringify(mergedDerived),
  );
  window.localStorage.setItem(
    OVERRIDES_KEY(workspace),
    JSON.stringify(mergedOverrides),
  );
  dispatchChange();
}

/** Remove one derived task by id. */
export function removeDerived(workspace: string, id: string): void {
  const list = loadDerived(workspace).filter((d) => d.id !== id);
  saveDerived(workspace, list);
}

/** Remove one override by task_id. */
export function removeOverride(workspace: string, taskId: string): void {
  const list = loadOverrides(workspace).filter((o) => o.task_id !== taskId);
  saveOverrides(workspace, list);
}

/** Subscribe to worklist:change. Returns an unsubscribe fn. */
export function subscribeWorklistChange(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wrap = () => handler();
  window.addEventListener("worklist:change", wrap);
  window.addEventListener("storage", wrap);
  return () => {
    window.removeEventListener("worklist:change", wrap);
    window.removeEventListener("storage", wrap);
  };
}

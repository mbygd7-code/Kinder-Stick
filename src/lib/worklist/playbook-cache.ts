/**
 * Playbook 결과 캐시 — 한 번 생성된 task 의 AI 자료를 재사용하기 위한 키 설계.
 *
 * 핵심 아이디어:
 *  - cache key 는 task ID 만이 아니라 task **콘텐츠 해시** 를 포함한다.
 *  - 따라서 task 정의(title/why/team/phase/cadence/tier/hint/ai_leverage 등) 가
 *    변하지 않은 카드는 새 버전이 배포돼도 그대로 재사용 (즉시 표시).
 *  - 일부 카드만 수정되면 → 해당 카드만 새 hash 로 cache miss → 재생성.
 *  - 전체 CACHE_VERSION 은 출력 스키마(JSON 구조)가 바뀔 때만 bump.
 *
 * 결과: 사용자는 진단 후 처음 개의 task 만 생성되고, 나머지는 즉시 표시됨.
 *      이전 세션의 결과도 task 콘텐츠가 같으면 그대로 재사용됨.
 */

import type { Task } from "@/lib/worklist/catalog";
import { getAiLeverage, getFunnelStage } from "@/lib/worklist/catalog";

// 출력 JSON 스키마 (PlaybookData) 가 바뀔 때만 bump.
// task 콘텐츠 변경에 의한 무효화는 taskHash 가 자동 처리하므로, 여기서는 v 만 관리.
export const CACHE_VERSION = "v5";

export interface PlaybookData {
  summary: string;
  output: string;
  steps: Array<{
    title: string;
    detail: string;
    owner?: string;
    estimated_hours?: number;
  }>;
  kpis: Array<{ name: string; threshold: string; method: string }>;
  sample: string;
  pitfalls: string[];
  references: string[];
  model: string;
  generated_at: string;
}

/**
 * 빠르고 가벼운 32-bit 해시 (FNV-1a 변형). 암호학적 안전이 아닌 캐시 키 용도.
 * 같은 입력 → 같은 8자리 hex.
 */
function hash32(s: string): string {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

/**
 * task 의 의미있는 필드만 추출해 안정적으로 직렬화 → hash.
 * 같은 task 정의면 어떤 환경에서도 동일한 hash.
 */
export function taskContentHash(task: Task): string {
  const stable = JSON.stringify([
    task.id,
    task.title,
    task.why,
    task.team,
    task.phase,
    getFunnelStage(task) ?? "",
    task.cadence,
    task.tier,
    task.domain ?? "",
    task.hint ?? "",
    getAiLeverage(task) ?? "",
  ]);
  return hash32(stable);
}

/**
 * 캐시 키 — taskId + 콘텐츠 hash 조합.
 * 같은 카드라도 내용이 바뀌면 hash 가 달라져 자동으로 새 캐시 슬롯 사용.
 * 이전 hash 의 캐시는 남지만 더 이상 읽히지 않음 (다음 cleanup 에서 제거 가능).
 */
export function playbookCacheKey(task: Task): string {
  return `worklist:playbook:${CACHE_VERSION}:${task.id}:${taskContentHash(task)}`;
}

export function loadPlaybook(task: Task): PlaybookData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(playbookCacheKey(task));
    if (!raw) return null;
    return JSON.parse(raw) as PlaybookData;
  } catch {
    return null;
  }
}

export function savePlaybook(task: Task, p: PlaybookData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(playbookCacheKey(task), JSON.stringify(p));
  } catch {
    /* quota exceeded — 사일런트 무시 */
  }
}

export function removePlaybook(task: Task): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(playbookCacheKey(task));
}

export function hasPlaybook(task: Task): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(playbookCacheKey(task)) !== null;
}

/**
 * 오래된 cache 정리 — 같은 taskId 로 저장된 다른 hash 의 항목과
 * 이전 CACHE_VERSION 항목을 한 번에 제거. 페이지 mount 시 1회 호출 권장.
 *
 * "bytes saved" 가 의미있을 만큼 자주 호출하지는 않음 — 옵션 기능.
 */
export function pruneOldPlaybookEntries(allTasks: Task[]): number {
  if (typeof window === "undefined") return 0;
  const validKeys = new Set(allTasks.map(playbookCacheKey));
  let removed = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (!k.startsWith("worklist:playbook:")) continue;
      if (validKeys.has(k)) continue; // 현재 유효한 캐시는 보존
      keysToRemove.push(k);
    }
    for (const k of keysToRemove) {
      window.localStorage.removeItem(k);
      removed++;
    }
  } catch {
    /* ignore */
  }
  return removed;
}

/**
 * 번들된 default playbook JSON 의 형식.
 * scripts/generate-default-playbooks.mjs 가 생성, /public/playbook-defaults.json 으로 배포.
 *
 * 각 entry 의 task_hash 가 현재 taskContentHash(task) 와 일치할 때만 시드한다 →
 * task 정의가 바뀐 카드는 default 가 stale 이므로 무시되고 AI 가 새로 생성.
 */
export interface PlaybookDefaultsBundle {
  generated_at: string;
  cache_version: string;
  entries: Array<{
    task_id: string;
    task_hash: string;
    data: PlaybookData;
  }>;
}

/**
 * 번들된 default playbook 들을 localStorage 에 시드.
 * - 이미 캐시가 있는 task → 건드리지 않음 (사용자가 ops_context 로 재생성한 결과 보존)
 * - hash 가 stale 한 default → 스킵
 * - 위 둘 다 아닐 때만 saveDefault → bulk generator 가 즉시 cache hit 으로 인식
 *
 * 1회 fetch 후 sessionStorage 에 마킹해 동일 세션 중복 fetch 방지.
 *
 * Returns: { seeded, alreadyCached, stale, total } 통계.
 */
export async function seedPlaybookDefaultsFromBundle(
  allTasks: Task[],
  url = "/playbook-defaults.json",
): Promise<{
  seeded: number;
  alreadyCached: number;
  stale: number;
  total: number;
}> {
  const stat = { seeded: 0, alreadyCached: 0, stale: 0, total: allTasks.length };
  if (typeof window === "undefined") return stat;
  const SEEDED_FLAG = `worklist:playbook:seeded:${CACHE_VERSION}`;
  if (window.sessionStorage.getItem(SEEDED_FLAG)) return stat;

  let bundle: PlaybookDefaultsBundle | null = null;
  try {
    const r = await fetch(url, { cache: "force-cache" });
    if (!r.ok) return stat;
    bundle = (await r.json()) as PlaybookDefaultsBundle;
  } catch {
    return stat;
  }
  if (!bundle || !Array.isArray(bundle.entries)) return stat;

  // task_id → entry 빠른 lookup
  const byId = new Map<string, PlaybookDefaultsBundle["entries"][number]>();
  for (const e of bundle.entries) byId.set(e.task_id, e);

  for (const task of allTasks) {
    const entry = byId.get(task.id);
    if (!entry) continue;
    if (hasPlaybook(task)) {
      stat.alreadyCached++;
      continue;
    }
    const currentHash = taskContentHash(task);
    if (entry.task_hash !== currentHash) {
      stat.stale++;
      continue;
    }
    savePlaybook(task, entry.data);
    stat.seeded++;
  }

  window.sessionStorage.setItem(SEEDED_FLAG, "1");
  return stat;
}

// =====================================================================
// Supabase 공유 캐시 — 같은 워크스페이스 멤버끼리 결과 공유
// =====================================================================
// 구조:
//   1. 클라이언트가 playbook 생성 → localStorage 즉시 저장 + Supabase 비동기 upsert
//   2. 새 사용자/기기 가 워크리스트 진입 → hydrateFromSupabase() 가 워크스페이스의
//      모든 캐시 entry 를 한 번에 받아 localStorage 시드 → 즉시 표시
//   3. RLS 가 워크스페이스 멤버십 검증 → 다른 회사 데이터 누출 차단
//
// Supabase 미설정 환경 (mock mode) 에서는 graceful 하게 무시, localStorage 만 작동.

interface SharedCacheEntry {
  task_id: string;
  task_hash: string;
  ops_hash: string;
  data: PlaybookData;
  updated_at: string;
}

/**
 * Supabase 에서 워크스페이스의 모든 공유 캐시를 가져와 localStorage 시드.
 * - 같은 task_hash 의 캐시가 이미 localStorage 에 있으면 건드리지 않음
 *   (사용자가 ops_context 로 재생성한 결과 보존)
 * - hash mismatch 인 stale 캐시는 무시
 *
 * sessionStorage 마킹으로 동일 세션 중복 호출 방지.
 *
 * Returns: { hydrated, alreadyCached, stale, total } 통계.
 */
export async function hydrateSharedPlaybookCache(
  workspace: string,
  allTasks: Task[],
): Promise<{
  hydrated: number;
  alreadyCached: number;
  stale: number;
  total: number;
  shared: boolean;
}> {
  const stat = {
    hydrated: 0,
    alreadyCached: 0,
    stale: 0,
    total: allTasks.length,
    shared: false,
  };
  if (typeof window === "undefined" || !workspace) return stat;

  const HYDRATED_FLAG = `worklist:playbook:hydrated:${workspace}:${CACHE_VERSION}`;
  if (window.sessionStorage.getItem(HYDRATED_FLAG)) return stat;

  let entries: SharedCacheEntry[] = [];
  try {
    const r = await fetch(
      `/api/worklist/playbook-cache?workspace=${encodeURIComponent(workspace)}`,
      { cache: "no-store" },
    );
    if (!r.ok) return stat;
    const json = (await r.json()) as {
      entries?: SharedCacheEntry[];
      shared?: boolean;
    };
    entries = json.entries ?? [];
    stat.shared = !!json.shared;
  } catch {
    return stat;
  }

  if (!stat.shared) return stat;

  // task_id → task lookup
  const taskById = new Map<string, Task>();
  for (const t of allTasks) taskById.set(t.id, t);

  // 같은 task_id 가 여러 ops_hash 로 저장돼 있으면 가장 최근 updated_at 우선
  const bestPerTaskId = new Map<string, SharedCacheEntry>();
  for (const e of entries) {
    const prev = bestPerTaskId.get(e.task_id);
    if (!prev || prev.updated_at < e.updated_at) {
      bestPerTaskId.set(e.task_id, e);
    }
  }

  for (const [task_id, entry] of bestPerTaskId) {
    const task = taskById.get(task_id);
    if (!task) continue;
    if (hasPlaybook(task)) {
      stat.alreadyCached++;
      continue;
    }
    const currentHash = taskContentHash(task);
    if (entry.task_hash !== currentHash) {
      stat.stale++;
      continue;
    }
    savePlaybook(task, entry.data);
    stat.hydrated++;
  }

  window.sessionStorage.setItem(HYDRATED_FLAG, "1");
  return stat;
}

/**
 * 새로 생성된 playbook 을 Supabase 공유 캐시에 비동기 업로드.
 * 실패해도 무시 (localStorage 로 fallback).
 */
export function uploadPlaybookToSharedCache(
  workspace: string,
  task: Task,
  data: PlaybookData,
  opsHash = "generic",
): void {
  if (typeof window === "undefined" || !workspace) return;
  const payload = {
    workspace,
    task_id: task.id,
    task_hash: taskContentHash(task),
    ops_hash: opsHash,
    data,
  };
  // fire-and-forget — UI 차단 없음
  fetch("/api/worklist/playbook-cache", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true, // 페이지 navigation 중에도 완료
  }).catch(() => {
    /* 공유 실패 — silent. localStorage 캐시는 이미 저장됨 */
  });
}

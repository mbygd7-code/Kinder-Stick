"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TASKS,
  getFunnelStage,
  getAiLeverage,
  type Task,
} from "@/lib/worklist/catalog";

/**
 * Bulk Playbook Generator — 진단 완료 후 모든 업무 카드의 실무 자료(playbook)를
 * 백그라운드에서 동시 3개씩 생성한다.
 *
 * 동작:
 *  1. mount 시 hasDiagnosis 이고, 자동 시작 플래그가 없으면 자동으로 시작
 *  2. 사용자가 [시작] 클릭으로도 가능
 *  3. 일시중지 / 재개 / 닫기(영구 dismiss) 지원
 *  4. 각 생성 완료 시 worklist:change 이벤트 발행 → TaskKpiChecklist 자동 갱신
 *  5. localStorage 키:
 *      worklist:bulk:auto-started:{ws}  → 자동 시작 1회 플래그
 *      worklist:bulk:dismissed:{ws}     → 사용자가 닫기 누르면 더 안 보임
 *      worklist:playbook:v4:{taskId}    → 개별 결과 (TaskDescriptionPopover와 공유)
 */

const PLAYBOOK_CACHE = (taskId: string) => `worklist:playbook:v4:${taskId}`;
const AUTO_FLAG = (ws: string) => `worklist:bulk:auto-started:${ws}`;
const DISMISS_FLAG = (ws: string) => `worklist:bulk:dismissed:${ws}`;
/** 생성이 시작되어 아직 끝나지 않았음을 표시 — 페이지 재방문 시 자동 재개에 사용. */
const RUNNING_FLAG = (ws: string) => `worklist:bulk:running:${ws}`;
/**
 * 동시 요청 수.
 *  - production: 8 (Anthropic prompt cache hit + 빠른 서버)
 *  - development: 2 (Turbopack 컴파일 + dev server SSR 부담 회피)
 *    dev mode 에서 4 이상이면 페이지 navigation 이 막힘.
 */
const CONCURRENCY = process.env.NODE_ENV === "production" ? 8 : 2;

interface Props {
  workspace: string;
  hasDiagnosis: boolean;
}

type Phase = "idle" | "running" | "paused" | "complete" | "dismissed";

function hasPlaybook(taskId: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PLAYBOOK_CACHE(taskId)) !== null;
}

/**
 * 진행 상태 변경 시 TopNav 등 외부에 알림.
 * 워크리스트 GNB 링크 아래 로딩 바 표시에 사용.
 */
function notifyBulkState(active: boolean, workspace: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("worklist:bulk:state", {
      detail: { active, workspace },
    }),
  );
}

interface PlaybookPayload {
  task_id: string;
  title: string;
  why: string;
  team: string;
  phase: string;
  funnel_stage: string;
  cadence: string;
  tier: string;
  domain?: string;
  hint?: string;
  ai_leverage?: string;
}

function buildPayload(task: Task): PlaybookPayload {
  return {
    task_id: task.id,
    title: task.title,
    why: task.why,
    team: task.team,
    phase: task.phase,
    funnel_stage: getFunnelStage(task),
    cadence: task.cadence,
    tier: task.tier,
    domain: task.domain,
    hint: task.hint,
    ai_leverage: getAiLeverage(task),
  };
}

async function generateOne(task: Task, workspace: string): Promise<void> {
  const r = await fetch("/api/worklist/playbook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildPayload(task)),
  });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }
  const data = await r.json();
  window.localStorage.setItem(PLAYBOOK_CACHE(task.id), JSON.stringify(data));
  // 이벤트에 task.id 를 포함 → 해당 카드 리스너만 반응, 138개 모두 깨우지 않음.
  window.dispatchEvent(
    new CustomEvent("worklist:change", {
      detail: { workspace, taskId: task.id, source: "bulk" },
    }),
  );
}

export function BulkPlaybookGenerator({ workspace, hasDiagnosis }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const cancelRef = useRef(false);
  const startedAtRef = useRef(0);
  const initRef = useRef(false);

  // Initialize counts + check if already complete / dismissed
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initRef.current) return;
    initRef.current = true;

    const tot = TASKS.length;
    const initialDone = TASKS.filter((t) => hasPlaybook(t.id)).length;
    setTotal(tot);
    setDone(initialDone);

    const isDismissed =
      window.localStorage.getItem(DISMISS_FLAG(workspace)) !== null;
    if (isDismissed) {
      setPhase("dismissed");
      return;
    }
    if (initialDone >= tot) {
      setPhase("complete");
      return;
    }
  }, [workspace]);

  // Start generation (manual or auto)
  const start = useCallback(async () => {
    if (typeof window === "undefined") return;
    setError(null);
    setPhase("running");
    cancelRef.current = false;
    startedAtRef.current = Date.now();
    // 진행 중 플래그 — 페이지 떠난 뒤 돌아왔을 때 자동 재개 트리거
    window.localStorage.setItem(RUNNING_FLAG(workspace), Date.now().toString());
    notifyBulkState(true, workspace);

    // Find tasks that need playbook
    const todo = TASKS.filter((t) => !hasPlaybook(t.id));
    let localDone = TASKS.length - todo.length;

    // Worker pool
    let index = 0;
    const worker = async () => {
      while (index < todo.length && !cancelRef.current) {
        // 페이지가 화면에 보이지 않으면 (다른 탭, 백그라운드) 1초 대기 후 재확인.
        // 사용자가 다른 페이지로 이동했거나 다른 탭으로 갔을 때 dev server를
        // 압박하지 않게 함.
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const myIdx = index++;
        const task = todo[myIdx];
        try {
          await generateOne(task, workspace);
        } catch {
          setFailed((f) => f + 1);
        }
        localDone++;
        setDone(localDone);
      }
    };

    const pool: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, todo.length); i++) {
      pool.push(worker());
    }

    try {
      await Promise.all(pool);
      if (cancelRef.current) {
        setPhase("paused");
        // 사용자가 일시 중지 → 자동 재개 안 되게 플래그 제거
        window.localStorage.removeItem(RUNNING_FLAG(workspace));
      } else {
        const remaining = TASKS.filter((t) => !hasPlaybook(t.id)).length;
        if (remaining === 0) {
          setPhase("complete");
          window.localStorage.removeItem(RUNNING_FLAG(workspace));
        } else {
          // 모두 완료되지 않은 채 워커가 끝남 (이상 케이스) — paused 상태로
          setPhase("paused");
          window.localStorage.removeItem(RUNNING_FLAG(workspace));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("paused");
      window.localStorage.removeItem(RUNNING_FLAG(workspace));
    }
    notifyBulkState(false, workspace);
  }, [workspace]);

  // Unmount cleanup — 사용자가 다른 페이지로 이동하면 워커를 정지시켜 dev server
  // 부담을 즉시 해제. RUNNING_FLAG 는 그대로 유지 → 워크리스트 페이지로 돌아오면
  // 자동 재개. 페이지 navigation 응답성이 우선.
  useEffect(() => {
    return () => {
      cancelRef.current = true;
    };
  }, []);

  // Auto-start / Auto-resume on visit
  // Two cases:
  //   1) 이전 세션이 진행 중이었음 (RUNNING_FLAG 존재)
  //      → 자동 재개 (사용자가 일시 중지하지 않은 한)
  //   2) 진단이 막 끝나서 첫 방문 (AUTO_FLAG 없음 + DISMISS 없음)
  //      → 최초 자동 시작
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasDiagnosis) return;
    if (phase !== "idle") return;
    if (done >= total && total > 0) return;

    const dismissFlag = window.localStorage.getItem(DISMISS_FLAG(workspace));
    if (dismissFlag) return;

    const runningFlag = window.localStorage.getItem(RUNNING_FLAG(workspace));
    if (runningFlag) {
      // 이전 세션이 중단됨 → 자동 재개
      void start();
      return;
    }

    const autoFlag = window.localStorage.getItem(AUTO_FLAG(workspace));
    if (autoFlag) return; // 1회 자동 시작은 이미 끝남 (사용자가 명시적으로 재시작해야 함)

    // 최초 자동 시작
    window.localStorage.setItem(AUTO_FLAG(workspace), Date.now().toString());
    void start();
  }, [hasDiagnosis, phase, done, total, workspace, start]);

  const pause = useCallback(() => {
    if (typeof window === "undefined") return;
    cancelRef.current = true;
    // 사용자 명시적 일시 중지 → 자동 재개 비활성
    window.localStorage.removeItem(RUNNING_FLAG(workspace));
    notifyBulkState(false, workspace);
  }, [workspace]);

  const dismiss = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DISMISS_FLAG(workspace), Date.now().toString());
    window.localStorage.removeItem(RUNNING_FLAG(workspace));
    setPhase("dismissed");
    cancelRef.current = true;
    notifyBulkState(false, workspace);
  }, [workspace]);

  // Don't render if dismissed or no diagnosis (no point auto-generating without context)
  if (phase === "dismissed") return null;
  if (!hasDiagnosis) return null;
  if (total === 0) return null;

  // Estimated time remaining
  const remaining = Math.max(0, total - done);
  const elapsed = startedAtRef.current
    ? (Date.now() - startedAtRef.current) / 1000
    : 0;
  const ratePerSec = elapsed > 0 && done > 0 ? done / elapsed : 0;
  const etaSec = ratePerSec > 0 ? Math.round(remaining / ratePerSec) : 0;
  const etaText =
    etaSec > 0
      ? etaSec > 60
        ? `약 ${Math.ceil(etaSec / 60)}분 남음`
        : `약 ${etaSec}초 남음`
      : "";

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm w-[22rem] bg-paper border-2 border-ink shadow-2xl">
      {/* Header */}
      <div className="px-4 py-3 border-b-2 border-ink flex items-center justify-between gap-2 bg-paper">
        <div className="flex items-baseline gap-2">
          <p className="t-label-accent">AI 자동 생성</p>
          {phase === "complete" ? (
            <span className="t-label-ink text-green">완료</span>
          ) : phase === "running" ? (
            <span className="t-label-ink text-amber">진행 중</span>
          ) : phase === "paused" ? (
            <span className="t-label-ink text-ink-soft">일시 중지</span>
          ) : (
            <span className="t-label">대기</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="t-label px-1.5 hover:text-ink"
            aria-label={collapsed ? "펼치기" : "접기"}
          >
            {collapsed ? "펼치기" : "접기"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="t-label px-1.5 hover:text-accent"
            aria-label="닫기"
          >
            닫기
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed ? (
        <div className="px-4 py-4 space-y-3">
          {phase === "idle" ? (
            <>
              <p className="t-body-sm">
                {done > 0 ? (
                  <>
                    이전에 시작했던 자동 생성 작업이 일시 중지되어 있습니다.
                    이어서 진행하려면 [재개]를 눌러주세요.
                  </>
                ) : (
                  <>
                    {total}개 업무 카드에 대한 실무 자료(샘플 템플릿·검증
                    KPI·진행 단계·자주 하는 실수)를 백그라운드에서 자동
                    생성합니다.
                  </>
                )}
              </p>
              <p className="t-meta">
                {done > 0 ? (
                  <>
                    이미 <strong className="text-ink">{done}개</strong> 생성됨 ·
                    남은 <strong className="text-ink">{total - done}개</strong>{" "}
                    ·{" "}
                  </>
                ) : null}
                약 {Math.ceil(((total - done) * 6) / 60)}분 소요 예상
              </p>
              <button
                type="button"
                onClick={start}
                className="w-full px-4 py-2 t-label-ink !text-paper bg-ink border-2 border-ink hover:bg-accent hover:border-accent"
              >
                {done > 0 ? "재개" : "생성 시작"}
              </button>
            </>
          ) : phase === "running" ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="t-display-3 text-ink t-num leading-none">
                  {done}
                  <span className="t-meta">/{total}</span>
                </span>
                <span className="t-label-ink text-accent t-num">
                  {percent}%
                </span>
              </div>
              <div className="h-2 bg-ink-soft/15 overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="t-meta">
                {etaText || "예상 시간 계산 중…"}
                {failed > 0 ? ` · 실패 ${failed}건` : ""}
              </p>
              <p className="t-meta leading-relaxed">
                다른 페이지로 이동하면 자동 일시 정지됩니다. 워크리스트로
                돌아오면 자동 재개.
              </p>
              <button
                type="button"
                onClick={pause}
                className="w-full px-3 py-1.5 t-label border-2 border-ink hover:bg-paper-deep"
              >
                일시 중지
              </button>
            </>
          ) : phase === "paused" ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="t-display-3 text-ink t-num leading-none">
                  {done}
                  <span className="t-meta">/{total}</span>
                </span>
                <span className="t-label-ink t-num">{percent}%</span>
              </div>
              <div className="h-2 bg-ink-soft/15 overflow-hidden">
                <div
                  className="h-full bg-ink-soft/60 transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="t-meta">
                일시 중지 · 남은 {total - done}개
                {failed > 0 ? ` · 실패 ${failed}건` : ""}
              </p>
              {error ? <p className="t-meta text-accent">{error}</p> : null}
              <button
                type="button"
                onClick={start}
                className="w-full px-3 py-1.5 t-label-ink !text-paper bg-ink border-2 border-ink hover:bg-accent hover:border-accent"
              >
                재개
              </button>
            </>
          ) : phase === "complete" ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="t-display-3 text-green t-num leading-none">
                  {total}
                  <span className="t-meta">/{total}</span>
                </span>
                <span className="t-label-ink text-green">완료</span>
              </div>
              <div className="h-2 bg-ink-soft/15 overflow-hidden">
                <div className="h-full bg-green" style={{ width: "100%" }} />
              </div>
              <p className="t-meta">
                모든 업무에 검증 KPI 체크리스트가 준비되었습니다.
                {failed > 0 ? ` (실패 ${failed}건은 카드에서 개별 재시도)` : ""}
              </p>
              <button
                type="button"
                onClick={dismiss}
                className="w-full px-3 py-1.5 t-label border-2 border-ink hover:bg-paper-deep"
              >
                닫기
              </button>
            </>
          ) : null}
        </div>
      ) : (
        // Collapsed mini-view
        <div className="px-4 py-2.5 flex items-baseline justify-between gap-2">
          <span className="t-meta t-num">
            {done}/{total} · {percent}%
          </span>
          {phase === "running" ? (
            <span className="inline-flex items-end gap-0.5" aria-hidden="true">
              <span className="w-1 h-1 rounded-full bg-amber animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1 h-1 rounded-full bg-amber animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1 h-1 rounded-full bg-amber animate-bounce" />
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TASKS,
  getFunnelStage,
  getAiLeverage,
  type Task,
} from "@/lib/worklist/catalog";
import {
  hasPlaybook as hasPlaybookCache,
  hydrateSharedPlaybookCache,
  playbookCacheKey,
  pruneOldPlaybookEntries,
  seedPlaybookDefaultsFromBundle,
  uploadPlaybookToSharedCache,
} from "@/lib/worklist/playbook-cache";
import { hydrateKpiChecksFromShared } from "./_task-kpi-checklist";

/**
 * Bulk Playbook Generator — 진단 완료 후 모든 업무 카드의 실무 자료(playbook)를
 * 백그라운드에서 동시 N개씩 생성한다.
 *
 * 캐시 전략 (v5):
 *  - cache key 가 task **콘텐츠 해시** 를 포함하므로 task 정의가 바뀌지 않은
 *    카드는 절대 재생성되지 않음 → 진단 다시 해도 변경된 카드만 새로 생성.
 *  - 일부 카드만 수정되면 → 해당 카드만 cache miss → 빠른 부분 재생성.
 *  - mount 시 pruneOldPlaybookEntries 로 이전 hash/version 의 잔여 캐시 정리.
 *
 * 동작:
 *  1. mount 시 hasDiagnosis 이고, 자동 시작 플래그가 없으면 자동으로 시작
 *  2. 사용자가 [시작] 클릭으로도 가능
 *  3. 일시중지 / 재개 / 닫기(영구 dismiss) 지원
 *  4. 각 생성 완료 시 worklist:change 이벤트 발행 → TaskKpiChecklist 자동 갱신
 *  5. localStorage 키:
 *      worklist:bulk:auto-started:{ws}  → 자동 시작 1회 플래그
 *      worklist:bulk:dismissed:{ws}     → 사용자가 닫기 누르면 더 안 보임
 *      worklist:playbook:v5:{taskId}:{taskHash}  → 개별 결과 (TaskDescriptionPopover 와 공유)
 */

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

function hasPlaybook(task: Task): boolean {
  return hasPlaybookCache(task);
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
  // bulk 생성은 의도적으로 ops_context 를 보내지 않음 →
  //   - 모든 워크스페이스가 같은 generic 결과를 공유 가능
  //   - taskHash 만으로 cache key 결정 → 한 번 생성하면 영구 재사용
  // 사용자가 자기 회사 데이터 반영을 원하면 카드에서 [재생성] 클릭 시
  // ops_context 가 자동 주입됨 (TaskDescriptionPopover.generate 참고).
  const r = await fetch("/api/worklist/playbook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildPayload(task)),
  });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }
  const data = await r.json();
  // 1) localStorage 즉시 저장 (instant cache)
  window.localStorage.setItem(playbookCacheKey(task), JSON.stringify(data));
  // 2) Supabase 공유 캐시 업로드 (팀원과 즉시 공유, fire-and-forget)
  uploadPlaybookToSharedCache(workspace, task, data, "generic");
  // 3) 이벤트에 task.id 를 포함 → 해당 카드 리스너만 반응, 164개 모두 깨우지 않음.
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
  // seeded: 번들 defaults + Supabase hydrate 가 모두 끝났음을 표시.
  // Auto-start 효과는 이 플래그가 true 가 되기 전에는 절대 트리거되지 않음 →
  // 새 브라우저(localStorage 비어있음) 에서 production 진입 시 Supabase 에 이미
  // 캐시된 결과를 hydrate 받기 전에 AI 재생성이 잘못 시작되는 race 방지.
  const [seeded, setSeeded] = useState(false);
  const cancelRef = useRef(false);
  const startedAtRef = useRef(0);
  const initRef = useRef(false);

  // Initialize counts + check if already complete / dismissed
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initRef.current) return;
    initRef.current = true;

    // 옛 hash·옛 CACHE_VERSION 의 잔여 캐시 제거 (storage quota 확보).
    pruneOldPlaybookEntries(TASKS);

    const tot = TASKS.length;
    setTotal(tot);

    // 시드 순서:
    //   (a) 번들된 default playbook → AI 호출 0회, 즉시 적용
    //   (b) Supabase 공유 캐시 → 팀원이 이전에 생성한 결과 hydrate (네트워크 1회)
    // 두 시드 모두 already-cached 항목은 건드리지 않음 → 사용자 ops_context 결과 보존.
    void (async () => {
      const dStat = await seedPlaybookDefaultsFromBundle(TASKS);
      const hStat = await hydrateSharedPlaybookCache(workspace, TASKS);
      // 팀 공유 KPI 체크 상태도 함께 hydrate — playbook 과 독립적으로 진행 가능.
      // 다른 기기·다른 멤버의 체크 진행이 즉시 보임.
      const kStat = await hydrateKpiChecksFromShared(workspace);
      const initialDone = TASKS.filter((t) => hasPlaybook(t)).length;
      setDone(initialDone);
      // seed 가 끝났음을 알림 → auto-start 효과가 이제 안전하게 평가 가능.
      // 이 시점에 Supabase 에 캐시된 결과까지 모두 localStorage 에 시드되어 있음 →
      // initialDone === total 이면 auto-start 가 자동으로 skip.
      setSeeded(true);
      const totalSeeded = dStat.seeded + hStat.hydrated;
      // 이벤트는 KPI checklist 등 외부 컴포넌트가 캐시 갱신을 즉시 반영하도록.
      // count 가 0 이어도 항상 발행 → 새 브라우저에서 hydrate 됐을 때 KPI 섹션이
      // "다 생성되면 나타나는" 증상 해결.
      window.dispatchEvent(
        new CustomEvent("worklist:change", {
          detail: {
            workspace,
            source: "seed",
            count: totalSeeded,
            defaults: dStat.seeded,
            shared: hStat.hydrated,
            kpi_hydrated: kStat.hydrated,
          },
        }),
      );
    })();

    const initialDone = TASKS.filter((t) => hasPlaybook(t)).length;
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
    const todo = TASKS.filter((t) => !hasPlaybook(t));
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
        const remaining = TASKS.filter((t) => !hasPlaybook(t)).length;
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
  //
  // CRITICAL: seed (defaults bundle + Supabase hydrate) 가 끝난 뒤에만 평가.
  // 그렇지 않으면 새 브라우저(또는 production 첫 진입) 에서 localStorage 가
  // 비어있어 done=0 으로 잘못 판정되어 이미 캐시된 카드까지 재생성하는
  // race condition 이 발생함.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasDiagnosis) return;
    if (!seeded) return; // ← seed 완료 전에는 자동 시작 금지
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
  }, [hasDiagnosis, phase, done, total, workspace, start, seeded]);

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

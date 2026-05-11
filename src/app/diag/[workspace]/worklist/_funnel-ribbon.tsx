"use client";

import { useState, useEffect } from "react";
import {
  FUNNEL_LABEL,
  FUNNEL_DESC,
  FUNNEL_ORDER,
  TASKS,
  TEAM_ORDER,
  getFunnelStage,
  type FunnelStage,
  type Status,
  type DerivedTask,
} from "@/lib/worklist/catalog";
import { loadDerived } from "@/lib/worklist/storage";

interface Props {
  workspace: string;
  counts: Record<FunnelStage, number>;
}

const TONE: Record<FunnelStage, string> = {
  awareness: "border-cobalt/50 bg-soft-cobalt/40",
  acquisition: "border-cobalt/50 bg-soft-cobalt/60",
  activation: "border-amber/50 bg-soft-amber/50",
  retention: "border-amber/50 bg-soft-amber/30",
  revenue: "border-green/50 bg-soft-green/50",
  referral: "border-green/40 bg-soft-green/30",
  expansion: "border-accent/40 bg-soft-red/30",
  internal: "border-ink-soft/30 bg-paper-deep",
};

export function FunnelRibbon({ workspace, counts }: Props) {
  const [active, setActive] = useState<FunnelStage | "all">("all");
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Broadcast funnel changes; FilterBar listens and applies the visibility
  // through a single unified effect.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("worklist:funnel", { detail: { active } }),
    );
  }, [active]);

  // Refresh on task status changes
  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("worklist:change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("worklist:change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  // Compute "done" count per funnel stage from localStorage
  // (only client-side; server initial render shows 0/total)
  const doneCounts: Record<FunnelStage, number> = {
    awareness: 0,
    acquisition: 0,
    activation: 0,
    retention: 0,
    revenue: 0,
    referral: 0,
    expansion: 0,
    internal: 0,
  };
  // Load derived tasks once per render (cheap — localStorage)
  let derived: DerivedTask[] = [];
  if (mounted) {
    derived = loadDerived(workspace);
    for (const t of TASKS) {
      const stage = getFunnelStage(t);
      try {
        const raw = window.localStorage.getItem(
          `worklist:${workspace}:${t.id}`,
        );
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { status: Status };
        if (parsed.status === "done") {
          doneCounts[stage] += 1;
        }
      } catch {
        // ignore
      }
    }
    // Also count done status for derived tasks
    for (const d of derived) {
      const stage = getFunnelStage(d);
      try {
        const raw = window.localStorage.getItem(
          `worklist:${workspace}:${d.id}`,
        );
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { status: Status };
        if (parsed.status === "done") doneCounts[stage] += 1;
      } catch {
        // ignore
      }
    }
  }
  // touch tick so it's a dep of computation
  void tick;

  // Add derived tasks to per-stage totals (client-side augmentation)
  const augmentedCounts: Record<FunnelStage, number> = { ...counts };
  for (const d of derived) {
    augmentedCounts[getFunnelStage(d)] += 1;
  }

  const total = Object.values(augmentedCounts).reduce((s, n) => s + n, 0);
  const totalDone = Object.values(doneCounts).reduce((s, n) => s + n, 0);

  return (
    <section className="border-2 border-ink bg-paper p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <div>
          <p className="kicker mb-1">고객여정 매핑 — 마케팅 퍼널 + 리텐션·그로스</p>
          <h2 className="font-display text-xl sm:text-2xl leading-tight">
            우리 업무는 고객의 어느 단계를 움직이나
          </h2>
          <p className="mt-1 label-mono">
            한 단계만 클릭하면 그 단계에 영향 주는 업무만 모아 봅니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActive("all")}
          className={`px-3 py-1.5 text-sm font-medium border-2 transition-colors ${
            active === "all"
              ? "bg-ink text-paper border-ink"
              : "bg-paper text-ink-soft border-ink-soft/40 hover:border-ink hover:text-ink"
          }`}
        >
          전체 {totalDone}/{total}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {FUNNEL_ORDER.map((s, i) => {
          const isCustomerFacing = s !== "internal";
          const isOn = active === s;
          const stageTotal = augmentedCounts[s] ?? 0;
          const stageDone = doneCounts[s] ?? 0;
          const pct =
            stageTotal > 0 ? Math.round((stageDone / stageTotal) * 100) : 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => {
                const next = isOn ? "all" : s;
                setActive(next);
                if (next !== "all") {
                  // Find the first team that has at least one task in this stage
                  // and scroll to its section header so the user sees the
                  // filtered list starting from a real (non-empty) team.
                  const firstTeam = TEAM_ORDER.find((team) =>
                    TASKS.some(
                      (t) => t.team === team && getFunnelStage(t) === next,
                    ),
                  );
                  if (firstTeam) {
                    scrollTeamHeaderToTop(firstTeam);
                  }
                }
              }}
              className={`relative text-left px-3 pt-2.5 pb-3 border-2 transition-all ${
                isOn
                  ? "border-ink bg-ink text-paper"
                  : `${TONE[s]} hover:border-ink hover:bg-paper`
              }`}
              title={`${FUNNEL_DESC[s]} · ${stageDone}/${stageTotal} 완료`}
            >
              {isCustomerFacing ? (
                <span
                  className={`absolute -top-2 left-2 px-1 text-[9px] font-mono tracking-widest ${
                    isOn ? "bg-ink text-paper" : "bg-paper text-ink-soft"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              ) : null}
              <p
                className={`font-display text-base font-medium leading-tight ${
                  isOn ? "text-paper" : "text-ink"
                }`}
              >
                {FUNNEL_LABEL[s]}
              </p>
              <p
                className={`mt-1 font-mono text-xl tabular-nums leading-none ${
                  isOn ? "text-paper" : "text-ink"
                }`}
              >
                <span className="font-bold">{stageDone}</span>
                <span
                  className={`text-xs ${
                    isOn ? "text-paper/70" : "text-ink-soft"
                  }`}
                >
                  /{stageTotal}
                </span>
              </p>
              {/* progress gauge */}
              <div
                className={`mt-2 h-1.5 border overflow-hidden ${
                  isOn
                    ? "border-paper/40 bg-ink/60"
                    : "border-ink-soft/30 bg-paper-deep"
                }`}
              >
                <div
                  className={`h-full transition-all duration-500 ${
                    isOn
                      ? "bg-paper"
                      : pct >= 80
                        ? "bg-green"
                        : pct >= 40
                          ? "bg-amber"
                          : "bg-signal-red"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p
                className={`mt-1 label-mono ${
                  isOn ? "!text-paper/70" : ""
                }`}
              >
                {pct}%
              </p>
            </button>
          );
        })}
      </div>
      <p className="mt-3 label-mono leading-relaxed">
        ⓘ 고객여정 = 인지 → 획득 → 활성화 → 유지 → 매출 → 추천 → 확장. 내부는
        백오피스 운영 (인프라·보안·팀·재무).
      </p>
    </section>
  );
}

/**
 * Sticky nav 두 줄(header h-14 + sub-nav h-11)과 border 2px*2 + safety 16px.
 * 정확한 값은 layout에서 측정해서 보정 — 측정 실패 시 fallback.
 */
const STICKY_NAV_FALLBACK_PX = 120;

function measureStickyNavHeight(): number {
  // TopNav는 root layout의 첫 `header[sticky]`. 동적으로 측정해서 폰트 로드·반응형
  // 변동까지 흡수.
  const header = document.querySelector<HTMLElement>("header.sticky");
  if (!header) return STICKY_NAV_FALLBACK_PX;
  return header.getBoundingClientRect().height;
}

/**
 * 클릭한 funnel 카드에 매칭되는 첫 팀의 헤더가 sticky nav 바로 아래에 정확히
 * 위치하도록 스크롤. FilterBar가 다른 팀들을 `display:none`으로 숨길 때까지
 * 기다린 뒤 측정해야 정확하므로 `setTimeout`으로 한 사이클 늦춤.
 */
function scrollTeamHeaderToTop(team: string): void {
  // FilterBar의 funnel 상태 useEffect가 동일 tick 안에서 끝나도록 50ms,
  // 안전하게 150ms 후 측정/스크롤.
  window.setTimeout(() => {
    const target = document.querySelector<HTMLElement>(
      `[data-team-section="${team}"]`,
    );
    if (!target) return;
    const navH = measureStickyNavHeight();
    const rect = target.getBoundingClientRect();
    // 8px 여유 — 헤더 윗선과 nav 바닥 사이에 짧은 숨통.
    const targetY = window.scrollY + rect.top - navH - 8;
    window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
  }, 150);
}

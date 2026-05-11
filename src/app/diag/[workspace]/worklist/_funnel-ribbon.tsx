"use client";

import { useState, useEffect } from "react";
import {
  FUNNEL_LABEL,
  FUNNEL_DESC,
  FUNNEL_ORDER,
  TASKS,
  getFunnelStage,
  type FunnelStage,
  type Status,
} from "@/lib/worklist/catalog";

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
  if (mounted) {
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
  }
  // touch tick so it's a dep of computation
  void tick;

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
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
          const stageTotal = counts[s] ?? 0;
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
                // Scroll to the team execution sections when a stage is selected
                if (next !== "all") {
                  const target = document.getElementById("team-sections");
                  if (target) {
                    target.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
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

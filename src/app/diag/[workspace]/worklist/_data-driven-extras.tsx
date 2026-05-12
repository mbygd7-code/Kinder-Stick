"use client";

import { useEffect, useState } from "react";
import {
  TEAM_LABEL,
  TEAM_ORDER,
  PHASE_LABEL,
  PHASE_ORDER,
  FUNNEL_LABEL,
  CADENCE_LABEL,
  TIER_LABEL,
  type DerivedTask,
  type TaskOverride,
  type Team,
} from "@/lib/worklist/catalog";
import {
  loadDerived,
  loadOverrides,
  subscribeWorklistChange,
} from "@/lib/worklist/storage";

interface Props {
  workspace: string;
}

/**
 * DataDrivenExtras — 워크리스트 페이지 하단에 두 영역을 보여준다:
 *  1) 신규 업무 (DerivedTask) — 팀별로 그룹핑된 카드 목록.
 *  2) 격상된 기존 업무 (TaskOverride) — DOM의 [data-task-id] 노드에 직접
 *     배지·메모를 주입하여 기존 task 카드 위에 시각적으로 표시.
 */
export function DataDrivenExtras({ workspace }: Props) {
  const [derived, setDerived] = useState<DerivedTask[]>([]);
  const [overrides, setOverrides] = useState<TaskOverride[]>([]);

  useEffect(() => {
    const refresh = () => {
      setDerived(loadDerived(workspace));
      setOverrides(loadOverrides(workspace));
    };
    refresh();
    return subscribeWorklistChange(refresh);
  }, [workspace]);

  // DOM 데코레이션 — overrides가 바뀌면 기존 task 카드에 배지/메모 주입.
  useEffect(() => {
    const SELECTOR_DATA = "data-override-injected";
    // 모든 이전 주입 제거
    const old = document.querySelectorAll(`[${SELECTOR_DATA}="1"]`);
    old.forEach((n) => n.remove());
    // 기존 카드의 강조 outline 제거
    document
      .querySelectorAll<HTMLElement>("[data-task-id]")
      .forEach((el) => el.classList.remove("ring-2", "ring-accent"));

    if (overrides.length === 0) return;

    for (const o of overrides) {
      const node = document.querySelector<HTMLElement>(
        `[data-task-id="${o.task_id}"]`,
      );
      if (!node) continue;
      node.classList.add("ring-2", "ring-accent");
      // 배지 삽입
      const badge = document.createElement("div");
      badge.setAttribute(SELECTOR_DATA, "1");
      badge.className =
        "absolute top-0 right-0 -translate-y-1/2 translate-x-2 z-10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest bg-accent text-paper border-2 border-accent";
      badge.textContent = "BOOST · 데이터로 격상";
      node.style.position = node.style.position || "relative";
      node.appendChild(badge);
      // urgency_note를 task 카드 내부 끝에 추가
      if (o.urgency_note) {
        const note = document.createElement("p");
        note.setAttribute(SELECTOR_DATA, "1");
        note.className =
          "mx-4 mb-3 mt-1 text-xs leading-snug px-2 py-1 bg-soft-red/40 border border-accent/50";
        note.innerHTML = `<span class="font-mono text-[10px] uppercase tracking-widest mr-1">격상 이유</span> ${escapeHtml(o.urgency_note)}`;
        node.appendChild(note);
      }
    }
  }, [overrides]);

  if (derived.length === 0 && overrides.length === 0) return null;

  // 팀별로 derived 그룹핑
  const derivedByTeam: Record<Team, DerivedTask[]> = {
    director: [],
    planning: [],
    design: [],
    engineering: [],
    operations: [],
    marketing: [],
  };
  for (const d of derived) derivedByTeam[d.team].push(d);

  return (
    <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-16">
      <div className="border-t-2 border-ink pt-6">
        <header className="mb-6">
          <p className="kicker mb-1">데이터 주도 변경</p>
          <h2 className="font-display text-3xl sm:text-4xl leading-tight tracking-tight">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] bg-ink text-paper px-2 py-0.5 mr-2 align-middle">NEW</span> 외부 데이터에서 도출된{" "}
            <span className="italic font-light">신규 업무</span>
          </h2>
          <p className="mt-2 label-mono">
            데이터 인입 패널에서 반영한 변경 — workspace 범위로만 적용됩니다.
            제거하려면 인입 패널 하단의 &ldquo;현재 적용됨&rdquo; 토글에서 ✕ 클릭.
          </p>
        </header>

        {derived.length > 0 ? (
          <div className="space-y-8">
            {TEAM_ORDER.map((team) => {
              const items = derivedByTeam[team];
              if (items.length === 0) return null;
              // sort by phase order
              items.sort(
                (a, b) =>
                  PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase),
              );
              return (
                <div key={team}>
                  <h3 className="font-display text-lg font-medium mb-3 pb-2 border-b border-ink-soft/30">
                    {TEAM_LABEL[team]}{" "}
                    <span className="label-mono">· {items.length}개 신규</span>
                  </h3>
                  <ol className="space-y-3">
                    {items.map((d, i) => (
                      <li
                        key={d.id}
                        className="relative border-2 border-accent/60 bg-soft-red/20 p-4 sm:p-5"
                      >
                        <span className="absolute top-0 right-0 -translate-y-1/2 translate-x-2 z-10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest bg-accent text-paper border-2 border-accent">
                          NEW
                        </span>
                        <div className="flex items-start gap-3 sm:gap-4">
                          <span className="font-mono text-xs text-ink-soft mt-1 w-6 shrink-0 tabular-nums">
                            {(i + 1).toString().padStart(2, "0")}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap mb-2">
                              <span
                                className={`tag ${
                                  d.tier === "must"
                                    ? "tag-accent"
                                    : d.tier === "conditional"
                                      ? "tag-gold"
                                      : "tag"
                                }`}
                              >
                                {TIER_LABEL[d.tier]}
                              </span>
                              <span className="label-mono">
                                {CADENCE_LABEL[d.cadence]}
                              </span>
                              <span className="label-mono px-1.5 bg-soft-cobalt/40 text-cobalt border border-cobalt/40">
                                {FUNNEL_LABEL[d.funnel_stage ?? "internal"]}
                              </span>
                              <span className="label-mono">
                                · {PHASE_LABEL[d.phase]}
                              </span>
                              <span className="label-mono">
                                · 신뢰도 {(d.confidence * 100).toFixed(0)}%
                              </span>
                            </div>
                            <p className="font-display text-base font-medium leading-tight">
                              {d.title}
                            </p>
                            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                              <span className="font-medium text-ink">왜:</span>{" "}
                              {d.why}
                            </p>
                            {d.source_insight ? (
                              <p className="mt-1.5 text-xs italic text-ink-soft leading-snug">
                                <span className="font-mono text-[10px] uppercase tracking-widest mr-1 not-italic">출처</span> {d.source_insight}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

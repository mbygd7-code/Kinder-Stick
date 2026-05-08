"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DEFAULT_GOALS,
  type Goals,
} from "@/lib/worklist/catalog";

interface Props {
  workspace: string;
}

function key(workspace: string): string {
  return `worklist:${workspace}:goals`;
}

function readGoals(workspace: string): Goals {
  if (typeof window === "undefined") return DEFAULT_GOALS;
  try {
    const raw = window.localStorage.getItem(key(workspace));
    if (!raw) return DEFAULT_GOALS;
    const parsed = JSON.parse(raw) as Partial<Goals>;
    return { ...DEFAULT_GOALS, ...parsed };
  } catch {
    return DEFAULT_GOALS;
  }
}

function writeGoals(workspace: string, goals: Goals): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(workspace), JSON.stringify(goals));
  window.dispatchEvent(
    new CustomEvent("worklist:goals", { detail: { workspace, goals } }),
  );
}

const NUMERIC_INPUT =
  "w-full px-3 py-2 font-mono text-base bg-paper border border-ink-soft/40 focus:border-ink focus:outline-none tabular-nums";

export function GoalsPanel({ workspace }: Props) {
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Goals>(DEFAULT_GOALS);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setGoals(readGoals(workspace));
  }, [workspace]);

  const startEdit = useCallback(() => {
    setDraft(goals);
    setEditing(true);
  }, [goals]);

  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  const save = useCallback(() => {
    writeGoals(workspace, draft);
    setGoals(draft);
    setEditing(false);
  }, [workspace, draft]);

  const allEmpty =
    goals.yearEndMembers === 0 &&
    goals.monthlyMembers === 0 &&
    goals.paidMembers === 0 &&
    goals.plcGroups === 0 &&
    goals.teacherLeaders === 0;

  // PLC implied member count (5–10명/그룹, 평균 8 가정)
  const plcImpliedMembers = goals.plcGroups * 8;

  // Calibration banners — show what gets accelerated based on current goals
  const accelerations: string[] = [];
  if (goals.monthlyMembers >= 500) {
    accelerations.push(
      "월 500명+ 목표 → 채널 효율·CAC payback·크리에이티브 갱신 주간 가속",
    );
  } else if (goals.monthlyMembers >= 300) {
    accelerations.push(
      "월 300명+ 목표 → 랜딩 A/B·크리에이티브 갱신 월간 가속",
    );
  }
  if (goals.paidMembers >= 300) {
    accelerations.push(
      "유료 300명+ 목표 → Up-sell 시그널 점검 월간 가속",
    );
  } else if (goals.paidMembers >= 200) {
    accelerations.push(
      "유료 200명+ 목표 → 업그레이드 화면 A/B 월간 가속",
    );
  }
  if (goals.plcGroups >= 50) {
    accelerations.push(
      "PLC 50개+ 목표 → 리더 모집·월간 PLC 리뷰 격주 가속",
    );
  } else if (goals.plcGroups >= 30) {
    accelerations.push(
      "PLC 30개+ 목표 → 리더 모집 마케팅 월간으로 가속",
    );
  }

  // Avoid hydration flash: render skeleton until mounted
  if (!mounted) {
    return (
      <div className="border-2 border-ink bg-paper-soft p-5 sm:p-6">
        <p className="kicker">회사 목표</p>
        <p className="mt-2 label-mono">불러오는 중…</p>
      </div>
    );
  }

  return (
    <section className="border-2 border-ink bg-paper-soft p-5 sm:p-6">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="kicker mb-1">회사 목표 — 우리의 숫자</p>
          <h2 className="font-display text-2xl sm:text-3xl leading-tight">
            {allEmpty ? "아직 목표가 비어 있습니다" : "현재 vs 목표"}
          </h2>
          <p className="mt-1 label-mono">
            목표를 입력하면 worklist의 횟수·강도가 자동으로 가속됩니다.
          </p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="btn-secondary text-sm !py-2"
          >
            <span className="font-mono text-xs">{allEmpty ? "+" : "✎"}</span>
            {allEmpty ? "목표 입력" : "목표 편집"}
          </button>
        ) : null}
      </header>

      {editing ? (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            label="연말 목표 회원수"
            value={draft.yearEndMembers}
            onChange={(v) => setDraft({ ...draft, yearEndMembers: v })}
          />
          <NumberField
            label="월 목표 신규 회원수"
            value={draft.monthlyMembers}
            onChange={(v) => setDraft({ ...draft, monthlyMembers: v })}
          />
          <NumberField
            label="유료 가입자 목표"
            value={draft.paidMembers}
            onChange={(v) => setDraft({ ...draft, paidMembers: v })}
          />
          <NumberField
            label="PLC 그룹 수 목표"
            value={draft.plcGroups}
            onChange={(v) => setDraft({ ...draft, plcGroups: v })}
            suffix="개"
            help="PLC = 교사 리더 1명 + 멤버 5–10명 단위 학습공동체"
          />
          <NumberField
            label="교사 리더 수 목표"
            value={draft.teacherLeaders}
            onChange={(v) => setDraft({ ...draft, teacherLeaders: v })}
          />
          <div className="border-t border-ink-soft/40 sm:col-span-2 pt-3 mt-1">
            <p className="kicker mb-2">현재 값 (수동 입력)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumberField
                label="현재 회원수"
                value={draft.currentMembers}
                onChange={(v) => setDraft({ ...draft, currentMembers: v })}
                compact
              />
              <NumberField
                label="현재 유료"
                value={draft.currentPaid}
                onChange={(v) => setDraft({ ...draft, currentPaid: v })}
                compact
              />
              <NumberField
                label="현재 PLC"
                value={draft.currentPlc}
                onChange={(v) => setDraft({ ...draft, currentPlc: v })}
                compact
              />
              <NumberField
                label="현재 리더"
                value={draft.currentTeacherLeaders}
                onChange={(v) =>
                  setDraft({ ...draft, currentTeacherLeaders: v })
                }
                compact
              />
            </div>
          </div>
          <div className="sm:col-span-2 flex items-center gap-3 pt-2 border-t border-ink-soft/30">
            <button
              type="button"
              onClick={save}
              className="btn-primary text-sm !py-2"
            >
              저장 <span className="font-mono text-xs">→</span>
            </button>
            <button
              type="button"
              onClick={cancel}
              className="label-mono hover:text-ink"
            >
              취소
            </button>
            <span className="ml-auto label-mono">
              저장 시 worklist의 가속 힌트가 즉시 갱신됩니다.
            </span>
          </div>
        </div>
      ) : allEmpty ? (
        <p className="mt-4 text-sm text-ink-soft">
          ‘목표 입력’ 버튼을 눌러 연말 회원·월 목표·유료·PLC 목표를 입력하세요.
          입력 후 worklist의 일부 업무는 회사 목표에 맞춰 더 자주·더 강하게
          수행되도록 가이드가 표시됩니다.
        </p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-5 gap-3">
            <ProgressCard
              label="회원수 (연말)"
              current={goals.currentMembers}
              target={goals.yearEndMembers}
            />
            <ProgressCard
              label="월 신규 (이번 달)"
              current={goals.currentMembers}
              target={goals.monthlyMembers}
              isMonthly
            />
            <ProgressCard
              label="유료 가입자"
              current={goals.currentPaid}
              target={goals.paidMembers}
            />
            <ProgressCard
              label="PLC 그룹"
              current={goals.currentPlc}
              target={goals.plcGroups}
              suffix={`개 · 회원 ${plcImpliedMembers}명 환산`}
            />
            <ProgressCard
              label="교사 리더"
              current={goals.currentTeacherLeaders}
              target={goals.teacherLeaders}
            />
          </div>

          {accelerations.length > 0 ? (
            <div className="mt-5 pt-4 border-t border-ink-soft/30">
              <p className="kicker mb-2">
                현재 목표 기준 가속 항목 · {accelerations.length}건
              </p>
              <ul className="space-y-1.5 text-sm">
                {accelerations.map((a, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="font-display text-base text-accent leading-none">
                      ↑
                    </span>
                    <span className="leading-snug">{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  help,
  compact,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  help?: string;
  compact?: boolean;
}) {
  return (
    <div>
      <label
        className={`label-mono mb-1 block ${compact ? "" : ""}`}
      >
        {label}
      </label>
      <div className="flex items-baseline gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={value || ""}
          placeholder="0"
          onChange={(e) => onChange(parseInt(e.target.value || "0", 10) || 0)}
          className={NUMERIC_INPUT}
        />
        {suffix ? <span className="label-mono shrink-0">{suffix}</span> : null}
      </div>
      {help ? <p className="mt-1 label-mono">{help}</p> : null}
    </div>
  );
}

function ProgressCard({
  label,
  current,
  target,
  isMonthly,
  suffix,
}: {
  label: string;
  current: number;
  target: number;
  isMonthly?: boolean;
  suffix?: string;
}) {
  if (target <= 0) {
    return (
      <div className="bg-paper border border-ink-soft/40 p-3">
        <p className="label-mono mb-1">{label}</p>
        <p className="font-display text-2xl leading-none">—</p>
        <p className="mt-1 label-mono opacity-60">목표 미설정</p>
      </div>
    );
  }
  const pct = Math.min(
    100,
    Math.max(0, target > 0 ? Math.round((current / target) * 100) : 0),
  );
  const tone =
    pct >= 80 ? "bg-green" : pct >= 40 ? "bg-amber" : "bg-signal-red";
  return (
    <div className="bg-paper border border-ink-soft/40 p-3">
      <p className="label-mono mb-1 truncate" title={label}>
        {label}
      </p>
      <p className="font-display text-2xl leading-none tabular-nums">
        {current.toLocaleString()}
        <span className="font-mono text-xs text-ink-soft">
          {" / "}
          {target.toLocaleString()}
        </span>
      </p>
      <div className="mt-2 h-1.5 bg-paper-deep border border-ink-soft/30 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 label-mono">
        {pct}%{isMonthly ? " · 월 누적" : ""}
        {suffix ? ` · ${suffix}` : ""}
      </p>
    </div>
  );
}

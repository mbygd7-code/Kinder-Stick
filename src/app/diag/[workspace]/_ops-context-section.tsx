"use client";

/**
 * 운영 컨텍스트 섹션 — Appendix F + G 적용.
 *
 * 진단 시작 전 회사 운영 데이터·목표를 입력받아 (선택)
 * 추후 적응형 진단 시스템에서 활용.
 *
 * 현재는 localStorage 저장 + 진단 응답에 메타 동봉.
 * 풀 AI 적응 단계 (DiagnosisProfile 생성) 는 Phase F 별도 작업.
 */

import { useEffect, useState } from "react";

export interface OpsContext {
  /** 한 달 활성 사용자 */
  mau?: number;
  /** 주간 활성 사용자 */
  wau?: number;
  /** 한 달 신규 가입 */
  new_signups_monthly?: number;
  /** 한 달 이탈 */
  churn_monthly?: number;
  /** 추천 의향 점수 (NPS) -100 ~ 100 */
  nps?: number;
  /** 이번 달 목표 (자유 1줄) */
  monthly_goal?: string;
  /** 올해 목표 (자유 1줄) */
  annual_goal?: string;
  /** 가장 큰 도전·우선순위 (자유) */
  context_note?: string;
  /** 마지막 업데이트 시각 */
  updated_at?: string;
}

const STORAGE_KEY_PREFIX = "kso-ops-context-";

interface Props {
  workspace: string;
  /** 변경 시 부모에게 알림 (제출 시 함께 보낼 때 사용) */
  onChange?: (ctx: OpsContext) => void;
  /** 기본 펼침 상태 */
  defaultOpen?: boolean;
}

export function OpsContextSection({
  workspace,
  onChange,
  defaultOpen = false,
}: Props) {
  const storageKey = `${STORAGE_KEY_PREFIX}${workspace}`;
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const [ctx, setCtx] = useState<OpsContext>({});
  const [moreVisible, setMoreVisible] = useState(false);

  // Load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setCtx(JSON.parse(raw) as OpsContext);
    } catch {
      // ignore
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  // Persist + notify
  useEffect(() => {
    if (!hydrated) return;
    const payload = { ...ctx, updated_at: new Date().toISOString() };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // quota
    }
    onChange?.(payload);
  }, [ctx, hydrated, storageKey, onChange]);

  function update<K extends keyof OpsContext>(key: K, value: OpsContext[K]) {
    setCtx((prev) => ({ ...prev, [key]: value }));
  }

  function clear() {
    if (!confirm("운영 정보를 모두 지웁니다. 계속할까요?")) return;
    setCtx({});
    localStorage.removeItem(storageKey);
  }

  const filledCount = [
    ctx.mau,
    ctx.wau,
    ctx.new_signups_monthly,
    ctx.churn_monthly,
    ctx.nps,
    ctx.monthly_goal,
    ctx.annual_goal,
    ctx.context_note,
  ].filter((v) => v !== undefined && v !== "" && v !== null).length;

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-6">
      <div className="border-2 border-ink-soft/40 bg-paper-soft">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 p-5 hover:bg-paper-deep/30 transition-colors text-left"
        >
          <div className="flex-1 min-w-0">
            <p className="kicker mb-1">선택 입력 · 회사 정보</p>
            <h2 className="font-display text-xl sm:text-2xl leading-tight">
              운영 숫자·목표 ({filledCount}/8 입력됨)
            </h2>
            <p className="mt-1 text-sm text-ink-soft leading-relaxed">
              회사 현재 상황·목표를 알려주면 진단 결과 해석과 추천 액션이
              더 정확해집니다. <strong>모두 선택 입력</strong> — 모르는 항목은 건너뛰세요.
            </p>
          </div>
          <span className="font-mono text-2xl shrink-0">{open ? "−" : "+"}</span>
        </button>

        {open ? (
          <div className="border-t border-ink-soft/30 p-5 sm:p-6 space-y-5">
            {/* 핵심 5개 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <NumField
                label="한 달 활성 사용자"
                hint="MAU · Monthly Active Users — 지난 30일 안에 한 번이라도 핵심 액션을 한 사용자 수"
                value={ctx.mau}
                onChange={(v) => update("mau", v)}
                placeholder="예: 8,000"
              />
              <NumField
                label="주간 활성 사용자"
                hint="WAU · Weekly Active Users — 지난 7일 활성 사용자 수"
                value={ctx.wau}
                onChange={(v) => update("wau", v)}
                placeholder="예: 3,500"
              />
              <NumField
                label="한 달 신규 가입"
                hint="이번 달 새로 가입한 사용자 수"
                value={ctx.new_signups_monthly}
                onChange={(v) => update("new_signups_monthly", v)}
                placeholder="예: 1,200"
              />
              <NumField
                label="한 달 이탈"
                hint="이번 달 사용을 멈춘 사용자 수 (해지·30일+ 미접속)"
                value={ctx.churn_monthly}
                onChange={(v) => update("churn_monthly", v)}
                placeholder="예: 250"
              />
              <NumField
                label="교사 NPS (-100 ~ 100)"
                hint="추천 의향 점수 (Net Promoter Score) — 0–10 답 중 promoter(9–10) - detractor(0–6)"
                value={ctx.nps}
                onChange={(v) => update("nps", v)}
                placeholder="예: 32"
                min={-100}
                max={100}
              />
            </div>

            {/* 더 보기 토글 */}
            {!moreVisible ? (
              <button
                type="button"
                onClick={() => setMoreVisible(true)}
                className="label-mono hover:text-ink"
              >
                + 목표·자유 컨텍스트 더 입력
              </button>
            ) : (
              <div className="space-y-3 pt-4 border-t border-ink-soft/30">
                <TextField
                  label="이번 달 목표"
                  hint="한 줄로. 예: '신규 가입 1,200명 + 활성 사용자 8,000명'"
                  value={ctx.monthly_goal ?? ""}
                  onChange={(v) => update("monthly_goal", v)}
                  placeholder="이번 달 가장 중요한 목표 1줄"
                />
                <TextField
                  label="올해 목표"
                  hint="OKR · Objectives and Key Results 형식 권장. 예: '연말까지 유료 회원 1만명'"
                  value={ctx.annual_goal ?? ""}
                  onChange={(v) => update("annual_goal", v)}
                  placeholder="올해 가장 중요한 목표 1줄"
                />
                <TextField
                  label="가장 큰 도전 / 우선순위"
                  hint="자유 서술. AI 가 진단 해석·코칭 추천에 활용"
                  value={ctx.context_note ?? ""}
                  onChange={(v) => update("context_note", v)}
                  placeholder="예: '교사 retention 이 50% 미만이어서 가장 큰 우선순위'"
                  multiline
                />
              </div>
            )}

            <div className="pt-3 border-t border-ink-soft/30 flex items-center justify-between gap-3 flex-wrap">
              <p className="label-mono">
                자동 저장됨 · 입력은 모두 선택사항
              </p>
              {filledCount > 0 ? (
                <button
                  type="button"
                  onClick={clear}
                  className="label-mono hover:text-signal-red"
                >
                  모두 지우기
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ============================================================
// Sub-components
// ============================================================

function NumField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  label: string;
  hint?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      {hint ? <span className="block label-mono mt-0.5">{hint}</span> : null}
      <input
        type="number"
        inputMode="numeric"
        value={value === undefined || Number.isNaN(value) ? "" : value}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (v === "") onChange(undefined);
          else {
            const n = Number(v);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
        placeholder={placeholder}
        min={min}
        max={max}
        className="mt-2 w-full px-3 py-2 border-2 border-ink-soft/40 bg-paper focus:border-ink focus:outline-none"
      />
    </label>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      {hint ? <span className="block label-mono mt-0.5">{hint}</span> : null}
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="mt-2 w-full px-3 py-2 border-2 border-ink-soft/40 bg-paper focus:border-ink focus:outline-none resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={200}
          className="mt-2 w-full px-3 py-2 border-2 border-ink-soft/40 bg-paper focus:border-ink focus:outline-none"
        />
      )}
    </label>
  );
}

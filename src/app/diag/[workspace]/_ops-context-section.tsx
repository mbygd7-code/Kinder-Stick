"use client";

/**
 * 운영 컨텍스트 섹션 — Appendix F + G 적용, 2026-05-15 재디자인.
 *
 * 진단 시작 전 회사 운영 데이터·목표를 입력받아 (선택)
 * 추후 적응형 진단 시스템에서 활용.
 *
 * 디자인 원칙:
 *   - 페이지의 editorial 톤(kicker + dotted-rule + asymmetric) 에 맞춤
 *   - 박스 두 겹 X — 진단 폼과 같은 max-w-5xl 흐름
 *   - 항상 펼침 — 진단 정확도에 핵심이라 숨기지 않음
 *   - 3단 그룹: 01 지금 → 02 어디로 → 03 왜 어려운가
 *   - 입력 진행률 progress bar + 자동 저장 timestamp
 */

import { useEffect, useMemo, useState } from "react";

export interface OpsContext {
  mau?: number;
  wau?: number;
  new_signups_monthly?: number;
  churn_monthly?: number;
  /** 월 유료 사용자 수 — 매출 직결 지표 */
  paid_users_monthly?: number;
  monthly_goal?: string;
  annual_goal?: string;
  context_note?: string;
  updated_at?: string;
}

const STORAGE_KEY_PREFIX = "kso-ops-context-";

interface Props {
  workspace: string;
  onChange?: (ctx: OpsContext) => void;
}

export function OpsContextSection({ workspace, onChange }: Props) {
  const storageKey = `${STORAGE_KEY_PREFIX}${workspace}`;
  const [hydrated, setHydrated] = useState(false);
  const [ctx, setCtx] = useState<OpsContext>({});
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as OpsContext;
        setCtx(parsed);
        if (parsed.updated_at) setLastSavedAt(new Date(parsed.updated_at));
      }
    } catch {
      // ignore
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    const now = new Date();
    const payload = { ...ctx, updated_at: now.toISOString() };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setLastSavedAt(now);
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
    setLastSavedAt(null);
  }

  const filled = useMemo(() => {
    const slots = [
      ctx.mau,
      ctx.wau,
      ctx.new_signups_monthly,
      ctx.churn_monthly,
      ctx.paid_users_monthly,
      ctx.monthly_goal,
      ctx.annual_goal,
      ctx.context_note,
    ];
    return slots.filter(
      (v) => v !== undefined && v !== "" && v !== null,
    ).length;
  }, [ctx]);

  // 파생 지표 — 사용자에게 컨텍스트 의미를 즉시 보여줌
  const derivedChurnRate =
    ctx.churn_monthly !== undefined &&
    ctx.mau !== undefined &&
    ctx.mau > 0
      ? Math.round((ctx.churn_monthly / ctx.mau) * 100)
      : null;
  const derivedWauMauRatio =
    ctx.wau !== undefined &&
    ctx.mau !== undefined &&
    ctx.mau > 0
      ? Math.round((ctx.wau / ctx.mau) * 100)
      : null;
  /** 유료 전환율 = 유료 / MAU. 영유아 EdTech 기준 5–15% 가 healthy. */
  const derivedPaidRate =
    ctx.paid_users_monthly !== undefined &&
    ctx.mau !== undefined &&
    ctx.mau > 0
      ? Math.round((ctx.paid_users_monthly / ctx.mau) * 100)
      : null;

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-12 pb-8">
      {/* ── Header ── */}
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-5">
        <div>
          <p className="kicker mb-2">
            <span className="section-num">No. </span>00 · 진단 정확도 향상
          </p>
          <h2 className="font-display text-3xl sm:text-4xl leading-[1.05] tracking-tight">
            우리 회사를{" "}
            <span className="italic font-light">알려주세요</span>
          </h2>
          <p className="mt-3 text-sm sm:text-base leading-relaxed text-ink-soft max-w-2xl">
            현재 운영 숫자와 목표를 알려주면 진단 결과 해석과 추천 액션이
            훨씬 정확해집니다. <strong>모두 선택 입력</strong> — 빈 칸은
            건너뛰어도 됩니다.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-display text-3xl leading-none">
            {filled}
            <span className="font-mono text-base text-ink-soft">/8</span>
          </p>
          <p className="label-mono mt-1">입력 완료</p>
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="h-1 bg-ink-soft/20 mb-10">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${(filled / 8) * 100}%` }}
        />
      </div>

      {/* ── 01 · 지금 (현재 상태) ── */}
      <div className="mb-10">
        <div className="flex items-baseline gap-3 mb-5 flex-wrap">
          <p className="kicker">
            <span className="section-num">01 · </span>지금
          </p>
          <span className="label-mono">현재 운영 숫자</span>
          {derivedChurnRate !== null ||
          derivedWauMauRatio !== null ||
          derivedPaidRate !== null ? (
            <span className="label-mono opacity-50">·</span>
          ) : null}
          {derivedChurnRate !== null ? (
            <span
              className={`label-mono ${
                derivedChurnRate > 10
                  ? "!text-signal-red"
                  : derivedChurnRate > 5
                    ? "!text-signal-amber"
                    : "!text-signal-green"
              }`}
            >
              churn {derivedChurnRate}%/월
            </span>
          ) : null}
          {derivedWauMauRatio !== null ? (
            <span className="label-mono">
              · WAU/MAU {derivedWauMauRatio}%
            </span>
          ) : null}
          {derivedPaidRate !== null ? (
            <span
              className={`label-mono ${
                derivedPaidRate >= 10
                  ? "!text-signal-green"
                  : derivedPaidRate >= 5
                    ? "!text-cobalt"
                    : "!text-signal-amber"
              }`}
            >
              · 유료 전환 {derivedPaidRate}%
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-7">
          <EditorialNumField
            label="한 달 활성 사용자"
            kicker="MAU"
            hint="지난 30일 안에 한 번이라도 핵심 액션을 한 사용자 수"
            value={ctx.mau}
            onChange={(v) => update("mau", v)}
            placeholder="8,000"
          />
          <EditorialNumField
            label="주간 활성 사용자"
            kicker="WAU"
            hint="지난 7일 활성 사용자 수"
            value={ctx.wau}
            onChange={(v) => update("wau", v)}
            placeholder="3,500"
          />
          <EditorialNumField
            label="한 달 신규 가입"
            kicker="NEW"
            hint="이번 달 새로 가입한 사용자 수"
            value={ctx.new_signups_monthly}
            onChange={(v) => update("new_signups_monthly", v)}
            placeholder="1,200"
          />
          <EditorialNumField
            label="한 달 이탈"
            kicker="CHURN"
            hint="해지·30일+ 미접속 사용자 수"
            value={ctx.churn_monthly}
            onChange={(v) => update("churn_monthly", v)}
            placeholder="250"
            tone="warning"
          />
        </div>

        {/* 월 유료 사용자 — 단독 강조 (매출 직결 지표) */}
        <div className="mt-7 pt-7 dotted-rule">
          <PaidUsersField
            value={ctx.paid_users_monthly}
            onChange={(v) => update("paid_users_monthly", v)}
            mau={ctx.mau}
          />
        </div>
      </div>

      {/* ── 02 · 어디로 (목표) ── */}
      <div className="mb-10 pt-8 border-t border-ink-soft/30">
        <div className="flex items-baseline gap-3 mb-5 flex-wrap">
          <p className="kicker">
            <span className="section-num">02 · </span>어디로
          </p>
          <span className="label-mono">이번 달·올해 목표</span>
        </div>

        <div className="space-y-6">
          <EditorialTextField
            label="이번 달 목표"
            kicker="THIS MONTH"
            hint="한 줄로 — 가장 중요한 한 가지"
            value={ctx.monthly_goal ?? ""}
            onChange={(v) => update("monthly_goal", v)}
            placeholder="예: 신규 가입 1,200명 + 활성 사용자 8,000명 유지"
          />
          <EditorialTextField
            label="올해 목표"
            kicker="THIS YEAR"
            hint="OKR 형식 권장 — 측정 가능한 결과로"
            value={ctx.annual_goal ?? ""}
            onChange={(v) => update("annual_goal", v)}
            placeholder="예: 연말까지 유료 회원 1만명 + 매출 5억"
          />
        </div>
      </div>

      {/* ── 03 · 왜 어려운가 (자유 서술) ── */}
      <div className="pt-8 border-t border-ink-soft/30">
        <div className="flex items-baseline gap-3 mb-5 flex-wrap">
          <p className="kicker">
            <span className="section-num">03 · </span>왜 어려운가
          </p>
          <span className="label-mono">자유 서술 · AI 해석에 활용</span>
        </div>

        <EditorialTextField
          label="가장 큰 도전 또는 우선순위"
          kicker="CHALLENGE"
          hint="자유롭게 — AI 코치가 진단 결과를 이 맥락에서 해석합니다"
          value={ctx.context_note ?? ""}
          onChange={(v) => update("context_note", v)}
          placeholder="예: 교사 retention 이 50% 미만이어서 가장 큰 우선순위. 알림장 도구 사용 비율은 높지만 활성화가 안 됨."
          multiline
        />
      </div>

      {/* ── Footer ── */}
      <div className="mt-10 pt-5 border-t border-ink flex items-baseline justify-between flex-wrap gap-3">
        <p className="label-mono">
          {lastSavedAt
            ? `✓ 자동 저장됨 — ${formatRelative(lastSavedAt)}`
            : "자동 저장 — 입력 즉시"}
        </p>
        {filled > 0 ? (
          <button
            type="button"
            onClick={clear}
            className="label-mono hover:text-signal-red"
          >
            모두 지우기
          </button>
        ) : null}
      </div>
    </section>
  );
}

// ============================================================================
// Sub-components — editorial style (no boxy borders)
// ============================================================================

function EditorialNumField({
  label,
  kicker,
  hint,
  value,
  onChange,
  placeholder,
  tone,
}: {
  label: string;
  kicker: string;
  hint: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  tone?: "warning" | "neutral";
}) {
  const filled = value !== undefined && !Number.isNaN(value);
  return (
    <label className="block group">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="label-mono">{kicker}</span>
        <span className="label-mono opacity-40">·</span>
        <span className="text-sm font-medium leading-tight">{label}</span>
      </div>
      <p className="label-mono text-ink-soft mb-2 leading-relaxed">{hint}</p>
      <div
        className={`flex items-baseline gap-2 border-b-2 transition-colors ${
          filled
            ? tone === "warning"
              ? "border-signal-amber"
              : "border-ink"
            : "border-ink-soft/40 group-focus-within:border-ink"
        }`}
      >
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
          className="flex-1 bg-transparent font-display text-3xl py-2 focus:outline-none placeholder:font-display placeholder:text-ink-soft/30"
        />
        {filled ? (
          <span className="label-mono shrink-0">{tone === "warning" ? "↓" : "✓"}</span>
        ) : null}
      </div>
    </label>
  );
}

function PaidUsersField({
  value,
  onChange,
  mau,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  mau: number | undefined;
}) {
  const filled = value !== undefined && !Number.isNaN(value);
  // 유료 전환율 (영유아 EdTech freemium 기준 5–15% 가 healthy)
  const paidRate =
    filled && value !== undefined && mau !== undefined && mau > 0
      ? Math.round((value / mau) * 100)
      : null;
  const band =
    paidRate === null
      ? "neutral"
      : paidRate >= 15
        ? "excellent"
        : paidRate >= 10
          ? "good"
          : paidRate >= 5
            ? "ok"
            : paidRate >= 2
              ? "weak"
              : "bad";
  const bandLabel: Record<string, string> = {
    excellent: "매우 우수",
    good: "양호",
    ok: "보통",
    weak: "주의",
    bad: "낮음",
    neutral: "—",
  };
  const bandTone: Record<string, string> = {
    excellent: "!text-signal-green",
    good: "!text-signal-green",
    ok: "!text-cobalt",
    weak: "!text-signal-amber",
    bad: "!text-signal-red",
    neutral: "!text-ink-soft",
  };

  return (
    <label className="block group">
      <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
        <span className="label-mono">PAID</span>
        <span className="label-mono opacity-40">·</span>
        <span className="text-sm font-medium leading-tight">
          월 유료 사용자 수
        </span>
        {paidRate !== null ? (
          <span className={`label-mono ml-2 ${bandTone[band]}`}>
            유료 전환 {paidRate}% · {bandLabel[band]}
          </span>
        ) : null}
      </div>
      <p className="label-mono text-ink-soft mb-3 leading-relaxed">
        이번 달 유료 결제·구독을 유지 중인 사용자 수 — 매출 직결 지표
        {mau === undefined ? null : ` · 영유아 EdTech freemium 5–15% 가 healthy`}
      </p>
      <div
        className={`flex items-baseline gap-2 border-b-2 transition-colors ${
          filled
            ? "border-ink"
            : "border-ink-soft/40 group-focus-within:border-ink"
        }`}
      >
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={value === undefined || Number.isNaN(value) ? "" : value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (v === "") onChange(undefined);
            else {
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0) onChange(n);
            }
          }}
          placeholder="800"
          className="flex-1 bg-transparent font-display text-3xl py-2 focus:outline-none placeholder:font-display placeholder:text-ink-soft/30"
        />
        <span className="label-mono shrink-0">명</span>
        {filled ? <span className="label-mono shrink-0">✓</span> : null}
      </div>
    </label>
  );
}

function EditorialTextField({
  label,
  kicker,
  hint,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  kicker: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const filled = value.trim().length > 0;
  return (
    <label className="block group">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="label-mono">{kicker}</span>
        <span className="label-mono opacity-40">·</span>
        <span className="text-sm font-medium leading-tight">{label}</span>
      </div>
      <p className="label-mono text-ink-soft mb-2 leading-relaxed">{hint}</p>
      <div
        className={`border-b-2 transition-colors ${
          filled
            ? "border-ink"
            : "border-ink-soft/40 group-focus-within:border-ink"
        }`}
      >
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="w-full bg-transparent text-base leading-relaxed py-2 focus:outline-none resize-none placeholder:text-ink-soft/40"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            maxLength={200}
            className="w-full bg-transparent text-base py-2 focus:outline-none placeholder:text-ink-soft/40"
          />
        )}
      </div>
    </label>
  );
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "방금 전";
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

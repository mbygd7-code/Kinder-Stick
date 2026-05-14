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
  // ── A. 활성 (Activity) ──
  mau?: number;
  wau?: number;

  // ── B. funnel ──
  new_signups_monthly?: number;
  churn_monthly?: number;
  /** D1 활성화율 (%) — A4.ACT.D1 매핑 */
  d1_activation_rate?: number;

  // ── C. 매출 ──
  /** 이번 달 매출 (KRW) */
  revenue_monthly_krw?: number;
  /** 월 유료 사용자 수 */
  paid_users_monthly?: number;
  /** NRR (%) — Net Revenue Retention. A13.NRR.RATE 매핑 */
  nrr_rate?: number;

  // ── Goals / context ──
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
      // A. 활성
      ctx.mau,
      ctx.wau,
      // B. funnel
      ctx.new_signups_monthly,
      ctx.churn_monthly,
      ctx.d1_activation_rate,
      // C. 매출
      ctx.revenue_monthly_krw,
      ctx.paid_users_monthly,
      ctx.nrr_rate,
      // Goals
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
  /** ARPU = 매출 / 유료 사용자 — KRW per user per month */
  const derivedArpu =
    ctx.revenue_monthly_krw !== undefined &&
    ctx.paid_users_monthly !== undefined &&
    ctx.paid_users_monthly > 0
      ? Math.round(ctx.revenue_monthly_krw / ctx.paid_users_monthly)
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
            <span className="font-mono text-base text-ink-soft">/11</span>
          </p>
          <p className="label-mono mt-1">입력 완료</p>
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="h-1 bg-ink-soft/20 mb-10">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${(filled / 11) * 100}%` }}
        />
      </div>

      {/* ── 01 · 지금 (현재 상태) ── */}
      <div className="mb-10">
        {/* Section 01 header + derived metrics line */}
        <div className="flex items-baseline gap-3 mb-3 flex-wrap">
          <p className="kicker">
            <span className="section-num">01 · </span>지금
          </p>
          <span className="label-mono">현재 운영 숫자</span>
        </div>

        {/* Derived 라인 — 입력될수록 채워짐 */}
        <DerivedLine
          churnRate={derivedChurnRate}
          wauMauRatio={derivedWauMauRatio}
          paidRate={derivedPaidRate}
          arpu={derivedArpu}
        />

        {/* ─── A. 사용자 활성 ─── */}
        <SubGroupLabel letter="A" title="사용자 활성" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-7">
          <EditorialNumField
            label="한 달 활성 사용자"
            kicker="MAU"
            hint="지난 30일 안에 한 번이라도 핵심 액션을 한 사용자 수"
            value={ctx.mau}
            onChange={(v) => update("mau", v)}
            placeholder="8,000"
            unit="명"
          />
          <EditorialNumField
            label="주간 활성 사용자"
            kicker="WAU"
            hint="지난 7일 활성 사용자 수"
            value={ctx.wau}
            onChange={(v) => update("wau", v)}
            placeholder="3,500"
            unit="명"
          />
        </div>

        {/* ─── B. 가입 · 이탈 · 활성화 funnel ─── */}
        <SubGroupLabel letter="B" title="가입·이탈·활성화 funnel" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-7">
          <EditorialNumField
            label="한 달 신규 가입"
            kicker="NEW"
            hint="이번 달 새로 가입한 사용자 수"
            value={ctx.new_signups_monthly}
            onChange={(v) => update("new_signups_monthly", v)}
            placeholder="1,200"
            unit="명"
          />
          <EditorialNumField
            label="한 달 이탈"
            kicker="CHURN"
            hint="해지·30일+ 미접속 사용자 수"
            value={ctx.churn_monthly}
            onChange={(v) => update("churn_monthly", v)}
            placeholder="250"
            unit="명"
            tone="warning"
          />
          <EditorialNumField
            label="D1 활성화율"
            kicker="D1 ACT"
            hint="가입 후 1일 안에 핵심 액션 도달 % · A4.ACT.D1 critical"
            value={ctx.d1_activation_rate}
            onChange={(v) => update("d1_activation_rate", v)}
            placeholder="35"
            unit="%"
            min={0}
            max={100}
          />
        </div>

        {/* ─── C. 매출 · 단위경제 ─── */}
        <SubGroupLabel letter="C" title="매출 · 단위경제" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-7">
          <EditorialNumField
            label="이번 달 매출"
            kicker="REVENUE"
            hint="이번 달 결제·구독 총합 · stage 검증 & ARPU 산출"
            value={ctx.revenue_monthly_krw}
            onChange={(v) => update("revenue_monthly_krw", v)}
            placeholder="5,000,000"
            unit="₩"
            min={0}
          />
          <EditorialNumField
            label="월 유료 사용자"
            kicker="PAID"
            hint="이번 달 결제·구독 유지 중 사용자 수"
            value={ctx.paid_users_monthly}
            onChange={(v) => update("paid_users_monthly", v)}
            placeholder="800"
            unit="명"
            min={0}
          />
          <EditorialNumField
            label="순매출 유지율"
            kicker="NRR"
            hint="(이번달 매출 ÷ 지난달 매출) × 100 · A13.NRR.RATE"
            value={ctx.nrr_rate}
            onChange={(v) => update("nrr_rate", v)}
            placeholder="105"
            unit="%"
            min={0}
            max={200}
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
  unit,
  min,
  max,
}: {
  label: string;
  kicker: string;
  hint: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  tone?: "warning" | "neutral";
  /** 단위 마커 — "명" | "%" | "₩" 등 */
  unit?: string;
  min?: number;
  max?: number;
}) {
  const filled = value !== undefined && !Number.isNaN(value);
  // KRW(₩) 는 prefix, 나머지는 suffix
  const isPrefix = unit === "₩";
  // KRW 큰 수 천단위 콤마 표시 (입력 중엔 raw, 비포커스 시 포맷). 단순화: 모든
  // ₩ 필드는 type=text + 콤마 표시; 그 외는 type=number.
  const isCurrency = unit === "₩";

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
        {isPrefix ? (
          <span className="font-display text-2xl text-ink-soft shrink-0">
            {unit}
          </span>
        ) : null}
        <input
          type={isCurrency ? "text" : "number"}
          inputMode="numeric"
          min={min}
          max={max}
          value={
            value === undefined || Number.isNaN(value)
              ? ""
              : isCurrency
                ? value.toLocaleString("ko-KR")
                : value
          }
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onChange(undefined);
              return;
            }
            // currency 는 콤마 제거 후 숫자 파싱
            const cleaned = isCurrency ? raw.replace(/,/g, "") : raw;
            const n = Number(cleaned);
            if (!Number.isFinite(n)) return;
            if (min !== undefined && n < min) return;
            if (max !== undefined && n > max) return;
            onChange(n);
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent font-display text-3xl py-2 focus:outline-none placeholder:font-display placeholder:text-ink-soft/30 min-w-0"
        />
        {!isPrefix && unit ? (
          <span className="label-mono shrink-0">{unit}</span>
        ) : null}
        {filled ? (
          <span className="label-mono shrink-0">
            {tone === "warning" ? "↓" : "✓"}
          </span>
        ) : null}
      </div>
    </label>
  );
}

// ─── Sub-group label (dotted-rule + letter prefix) ───
function SubGroupLabel({ letter, title }: { letter: string; title: string }) {
  return (
    <div className="mt-7 pt-5 dotted-rule flex items-baseline gap-3 mb-4 first:mt-0 first:pt-0 first:border-none">
      <span className="kicker">{letter}</span>
      <span className="label-mono opacity-40">·</span>
      <span className="font-display text-base leading-tight">{title}</span>
    </div>
  );
}

// ─── Derived metrics line — 입력될수록 채워짐 ───
function DerivedLine({
  churnRate,
  wauMauRatio,
  paidRate,
  arpu,
}: {
  churnRate: number | null;
  wauMauRatio: number | null;
  paidRate: number | null;
  arpu: number | null;
}) {
  const chips: Array<{ key: string; label: string; tone: string }> = [];

  if (churnRate !== null) {
    chips.push({
      key: "churn",
      label: `churn ${churnRate}%/월`,
      tone:
        churnRate > 10
          ? "!text-signal-red"
          : churnRate > 5
            ? "!text-signal-amber"
            : "!text-signal-green",
    });
  }
  if (wauMauRatio !== null) {
    chips.push({
      key: "wm",
      label: `WAU/MAU ${wauMauRatio}%`,
      tone:
        wauMauRatio >= 50
          ? "!text-signal-green"
          : wauMauRatio >= 30
            ? "!text-cobalt"
            : "!text-signal-amber",
    });
  }
  if (paidRate !== null) {
    chips.push({
      key: "paid",
      label: `유료 전환 ${paidRate}%`,
      tone:
        paidRate >= 10
          ? "!text-signal-green"
          : paidRate >= 5
            ? "!text-cobalt"
            : "!text-signal-amber",
    });
  }
  if (arpu !== null) {
    chips.push({
      key: "arpu",
      label: `ARPU ₩${arpu.toLocaleString("ko-KR")}`,
      tone: "!text-ink-soft",
    });
  }

  if (chips.length === 0) {
    return (
      <p className="label-mono text-ink-soft/60 mb-5">
        값을 입력하면 자동 계산된 비율 (churn, WAU/MAU, 유료 전환, ARPU)
        이 여기 표시됩니다.
      </p>
    );
  }

  return (
    <p className="mb-5 flex items-baseline gap-x-3 gap-y-1 flex-wrap">
      {chips.map((c, i) => (
        <span key={c.key} className={`label-mono ${c.tone}`}>
          {i > 0 ? <span className="opacity-30 mr-3">·</span> : null}
          {c.label}
        </span>
      ))}
    </p>
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

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

import { useEffect, useMemo, useState, useTransition } from "react";
import { FieldHistoryModal } from "./_field-history-modal";

export interface OpsContext {
  // ── 지금 · 현재 운영 (9) ──
  mau?: number;
  wau?: number;
  /** 총 누적 가입자 수 — 서비스 시작 이래 전체 회원 (활성/이탈 포함) */
  total_members?: number;
  new_signups_monthly?: number;
  churn_monthly?: number;
  /** D1 활성화율 (%) — A4.ACT.D1 매핑 */
  d1_activation_rate?: number;
  /** 이번 달 매출 (KRW) */
  revenue_monthly_krw?: number;
  /** 월 유료 사용자 수 */
  paid_users_monthly?: number;
  /** NRR (%) — Net Revenue Retention. A13.NRR.RATE 매핑 */
  nrr_rate?: number;

  // ── 이번 달 목표 (3) ──
  goal_new_signups_monthly?: number;
  goal_paid_users_monthly?: number;
  goal_plc_monthly?: number;

  // ── 올해 목표 (3) ──
  goal_total_members_annual?: number;
  goal_paid_subscribers_annual?: number;
  goal_plc_annual?: number;

  updated_at?: string;
}

const STORAGE_KEY_PREFIX = "kso-ops-context-";

interface ServerSnapshot {
  data: OpsContext;
  applied_at: string | null;
  applied_by_email: string | null;
  applied_by_name: string | null;
  revision: number;
}

interface Props {
  workspace: string;
  onChange?: (ctx: OpsContext) => void;
}

export function OpsContextSection({ workspace, onChange }: Props) {
  const storageKey = `${STORAGE_KEY_PREFIX}${workspace}`;
  const [hydrated, setHydrated] = useState(false);
  /** 화면에서 사용자가 편집 중인 draft */
  const [ctx, setCtx] = useState<OpsContext>({});
  /** 마지막 commit (서버 또는 첫 로드) — diff 비교용 */
  const [serverSnapshot, setServerSnapshot] = useState<ServerSnapshot | null>(
    null,
  );
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [applying, startApplying] = useTransition();
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  /** 변경 안내 toast — 다른 직원이 commit 한 값을 사용자가 덮어쓰는 상황 */
  const [changeWarning, setChangeWarning] = useState<string | null>(null);
  /** 이력 modal 상태 */
  const [historyModal, setHistoryModal] = useState<{
    field: string;
    label: string;
    unit?: string;
  } | null>(null);

  // ── 초기 로드: 서버 → 없으면 localStorage ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // 서버 fetch 우선
      try {
        const res = await fetch(
          `/api/ops-context/${encodeURIComponent(workspace)}`,
        );
        if (res.ok) {
          const d = await res.json();
          if (!cancelled && d.ok) {
            const snap: ServerSnapshot = {
              data: (d.data as OpsContext) ?? {},
              applied_at: d.applied_at ?? null,
              applied_by_email: d.applied_by_email ?? null,
              applied_by_name: d.applied_by_name ?? null,
              revision: d.revision ?? 0,
            };
            setServerSnapshot(snap);
            // 서버 값이 비어있고 localStorage 에 draft 가 있으면 draft 우선
            if (snap.revision > 0 && Object.keys(snap.data).length > 0) {
              setCtx(snap.data);
              if (snap.applied_at) {
                setLastSavedAt(new Date(snap.applied_at));
              }
              setHydrated(true);
              return;
            }
          }
        }
      } catch {
        // 서버 오류면 localStorage fallback
      }
      // localStorage fallback (서버 비어있거나 익명 시)
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as OpsContext;
          setCtx(parsed);
          if (parsed.updated_at) setLastSavedAt(new Date(parsed.updated_at));
        }
      } catch {}
      setHydrated(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspace, storageKey]);

  // ── localStorage 자동 저장 (draft) ──
  useEffect(() => {
    if (!hydrated) return;
    const now = new Date();
    const payload = { ...ctx, updated_at: now.toISOString() };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {}
    onChange?.(payload);
  }, [ctx, hydrated, storageKey, onChange]);

  // 변경이 서버 commit 과 차이 나는지 감지 → 안내 메시지
  useEffect(() => {
    if (!hydrated || !serverSnapshot || serverSnapshot.revision === 0) {
      setChangeWarning(null);
      return;
    }
    const diffFields = diffKeys(ctx, serverSnapshot.data);
    if (diffFields.length > 0) {
      const editor =
        serverSnapshot.applied_by_name ??
        serverSnapshot.applied_by_email?.split("@")[0] ??
        "이전 직원";
      setChangeWarning(
        `${editor} 가 적용한 값 ${diffFields.length}개를 변경 중입니다. "진단에 반영" 을 눌러 저장하세요.`,
      );
    } else {
      setChangeWarning(null);
    }
  }, [ctx, hydrated, serverSnapshot]);

  function update<K extends keyof OpsContext>(key: K, value: OpsContext[K]) {
    setCtx((prev) => ({ ...prev, [key]: value }));
    setApplyMsg(null);
    setApplyErr(null);
  }

  /** 이력 모달 열기 헬퍼 — 각 필드에서 호출 */
  const openHistory =
    (field: string, label: string, unit?: string) => () =>
      setHistoryModal({ field, label, unit });

  function clear() {
    if (!confirm("운영 정보를 모두 지웁니다. 계속할까요?")) return;
    setCtx({});
    localStorage.removeItem(storageKey);
    setLastSavedAt(null);
  }

  function applyToDiagnosis() {
    setApplyErr(null);
    setApplyMsg(null);
    startApplying(async () => {
      // 서버에 commit
      try {
        const res = await fetch(
          `/api/ops-context/${encodeURIComponent(workspace)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: stripMeta(ctx) }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (res.status === 401) {
            // 비로그인 — localStorage 만으로 진단·워크리스트 반영
            setApplyMsg(
              "로그인 안 됨 — 이 기기에서만 반영됩니다. 팀과 공유하려면 로그인하세요.",
            );
          } else {
            setApplyErr(data.message ?? "반영 실패");
            return;
          }
        } else {
          // 서버 commit 성공
          setServerSnapshot({
            data: ctx,
            applied_at: data.applied_at ?? new Date().toISOString(),
            applied_by_email: data.applied_by_email ?? null,
            applied_by_name: null,
            revision: data.revision ?? 1,
          });
          setLastSavedAt(new Date(data.applied_at ?? Date.now()));
          setApplyMsg(
            data.changes_count > 0
              ? `${data.changes_count}개 항목이 진단·워크리스트에 반영되었습니다.`
              : "변경 사항 없음 — 이미 최신 상태입니다.",
          );
          setChangeWarning(null);
        }
      } catch (e) {
        setApplyErr(String(e));
        return;
      }
      // adaptation banner / worklist applier 가 다시 평가하도록 storage 이벤트 발화
      try {
        window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
        // 같은 탭에서도 listener 가 동작하도록 CustomEvent
        window.dispatchEvent(
          new CustomEvent("ops-context:applied", { detail: { workspace } }),
        );
      } catch {}
    });
  }

  const filled = useMemo(() => {
    const slots = [
      // 지금 9개
      ctx.mau,
      ctx.wau,
      ctx.total_members,
      ctx.new_signups_monthly,
      ctx.churn_monthly,
      ctx.d1_activation_rate,
      ctx.revenue_monthly_krw,
      ctx.paid_users_monthly,
      ctx.nrr_rate,
      // 이번 달 목표 3개
      ctx.goal_new_signups_monthly,
      ctx.goal_paid_users_monthly,
      ctx.goal_plc_monthly,
      // 올해 목표 3개
      ctx.goal_total_members_annual,
      ctx.goal_paid_subscribers_annual,
      ctx.goal_plc_annual,
    ];
    return slots.filter(
      (v) => v !== undefined && v !== null && !Number.isNaN(v),
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
            <span className="font-mono text-base text-ink-soft">/15</span>
          </p>
          <p className="label-mono mt-1">입력 완료</p>
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="h-1 bg-ink-soft/20 mb-10">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${(filled / 15) * 100}%` }}
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
            onShowHistory={openHistory("mau", "한 달 활성 사용자", "명")}
          />
          <EditorialNumField
            label="주간 활성 사용자"
            kicker="WAU"
            hint="지난 7일 활성 사용자 수"
            value={ctx.wau}
            onChange={(v) => update("wau", v)}
            placeholder="3,500"
            unit="명"
            onShowHistory={openHistory("wau", "주간 활성 사용자", "명")}
          />
        </div>

        {/* ─── B. 가입 · 이탈 · 활성화 funnel ─── */}
        <SubGroupLabel letter="B" title="가입·이탈·활성화 funnel" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-7">
          <EditorialNumField
            label="총 가입자수"
            kicker="TOTAL"
            hint="서비스 시작 이래 누적 가입자 (활성+이탈 포함) · 연 목표 비교 기준"
            value={ctx.total_members}
            onChange={(v) => update("total_members", v)}
            placeholder="25,000"
            unit="명"
            min={0}
            onShowHistory={openHistory("total_members", "총 가입자수", "명")}
          />
          <EditorialNumField
            label="한 달 신규 가입"
            kicker="NEW"
            hint="이번 달 새로 가입한 사용자 수"
            value={ctx.new_signups_monthly}
            onChange={(v) => update("new_signups_monthly", v)}
            placeholder="1,200"
            unit="명"
            onShowHistory={openHistory(
              "new_signups_monthly",
              "한 달 신규 가입",
              "명",
            )}
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
            onShowHistory={openHistory("churn_monthly", "한 달 이탈", "명")}
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
            onShowHistory={openHistory("d1_activation_rate", "D1 활성화율", "%")}
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
            onShowHistory={openHistory("revenue_monthly_krw", "이번 달 매출", "₩")}
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
            onShowHistory={openHistory("paid_users_monthly", "월 유료 사용자", "명")}
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
            onShowHistory={openHistory("nrr_rate", "순매출 유지율", "%")}
          />
        </div>
      </div>

      {/* ── 02 · 어디로 (이번 달 목표) ── */}
      <div className="mb-10 pt-8 border-t border-ink-soft/30">
        <div className="flex items-baseline gap-3 mb-3 flex-wrap">
          <p className="kicker">
            <span className="section-num">02 · </span>이번 달 목표
          </p>
          <span className="label-mono">월간 핵심 지표 목표</span>
        </div>
        <GoalGapLine
          gaps={[
            {
              label: "신규 가입",
              current: ctx.new_signups_monthly,
              goal: ctx.goal_new_signups_monthly,
            },
            {
              label: "유료 사용자",
              current: ctx.paid_users_monthly,
              goal: ctx.goal_paid_users_monthly,
            },
          ]}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-7 mt-5">
          <EditorialNumField
            label="신규 가입자 수"
            kicker="NEW · GOAL"
            hint="이번 달 가입 목표"
            value={ctx.goal_new_signups_monthly}
            onChange={(v) => update("goal_new_signups_monthly", v)}
            placeholder="2,500"
            unit="명"
            min={0}
            onShowHistory={openHistory(
              "goal_new_signups_monthly",
              "이번 달 신규 가입자 수 목표",
              "명",
            )}
          />
          <EditorialNumField
            label="유료 사용자 수"
            kicker="PAID · GOAL"
            hint="이번 달 결제·구독 목표"
            value={ctx.goal_paid_users_monthly}
            onChange={(v) => update("goal_paid_users_monthly", v)}
            placeholder="1,500"
            unit="명"
            min={0}
            onShowHistory={openHistory(
              "goal_paid_users_monthly",
              "이번 달 유료 사용자 수 목표",
              "명",
            )}
          />
          <EditorialNumField
            label="PLC 수"
            kicker="PLC · GOAL"
            hint="이번 달 학습공동체(PLC) 운영 목표"
            value={ctx.goal_plc_monthly}
            onChange={(v) => update("goal_plc_monthly", v)}
            placeholder="20"
            unit="개"
            min={0}
            onShowHistory={openHistory(
              "goal_plc_monthly",
              "이번 달 PLC 수 목표",
              "개",
            )}
          />
        </div>
      </div>

      {/* ── 03 · 올해 목표 ── */}
      <div className="mb-10 pt-8 border-t border-ink-soft/30">
        <div className="flex items-baseline gap-3 mb-3 flex-wrap">
          <p className="kicker">
            <span className="section-num">03 · </span>올해 목표
          </p>
          <span className="label-mono">연간 누적 지표 목표</span>
        </div>
        <GoalGapLine
          gaps={[
            {
              label: "누적 회원",
              current: ctx.total_members ?? ctx.mau,
              goal: ctx.goal_total_members_annual,
              annualHint: true,
            },
            {
              label: "유료 구독자",
              current: ctx.paid_users_monthly,
              goal: ctx.goal_paid_subscribers_annual,
              annualHint: true,
            },
          ]}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-7 mt-5">
          <EditorialNumField
            label="누적 회원수"
            kicker="MEMBERS · YR"
            hint="연말까지 누적 가입자 목표"
            value={ctx.goal_total_members_annual}
            onChange={(v) => update("goal_total_members_annual", v)}
            placeholder="50,000"
            unit="명"
            min={0}
            onShowHistory={openHistory(
              "goal_total_members_annual",
              "올해 누적 회원수 목표",
              "명",
            )}
          />
          <EditorialNumField
            label="유료 구독자 수"
            kicker="PAID SUB · YR"
            hint="연말까지 유료 구독 유지 목표"
            value={ctx.goal_paid_subscribers_annual}
            onChange={(v) => update("goal_paid_subscribers_annual", v)}
            placeholder="10,000"
            unit="명"
            min={0}
            onShowHistory={openHistory(
              "goal_paid_subscribers_annual",
              "올해 유료 구독자 수 목표",
              "명",
            )}
          />
          <EditorialNumField
            label="PLC 수"
            kicker="PLC · YR"
            hint="연말까지 누적 PLC 운영 목표"
            value={ctx.goal_plc_annual}
            onChange={(v) => update("goal_plc_annual", v)}
            placeholder="200"
            unit="개"
            min={0}
            onShowHistory={openHistory(
              "goal_plc_annual",
              "올해 PLC 수 목표",
              "개",
            )}
          />
        </div>
      </div>

      {/* ── 변경 안내 toast ── */}
      {changeWarning ? (
        <div className="mt-8 border-2 border-signal-amber bg-soft-amber/30 p-4">
          <p className="kicker !text-signal-amber mb-1">
            변경 감지 — 아직 반영되지 않음
          </p>
          <p className="text-sm leading-relaxed">{changeWarning}</p>
        </div>
      ) : null}

      {/* ── 진단에 반영 버튼 + 메시지 ── */}
      <div className="mt-10 pt-6 border-t-2 border-ink">
        <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
          <div>
            <p className="kicker mb-1">진단·워크리스트에 적용</p>
            <h3 className="font-display text-xl leading-tight">
              입력한 데이터로{" "}
              <span className="italic font-light">진단을 맞춤화</span>
            </h3>
            <p className="mt-1 text-sm text-ink-soft leading-relaxed max-w-xl">
              "진단에 반영" 을 누르면 회사 컨디션 기반으로 진단 응답 카드와
              워크리스트 업무가 자동 강조·재정렬됩니다. 다른 직원이 이 진단
              카드를 열어도 같은 값이 기본으로 셋팅됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={applyToDiagnosis}
            disabled={applying || filled === 0}
            className="btn-primary disabled:opacity-50 shrink-0"
          >
            {applying ? "반영 중…" : "진단에 반영"}
            <span className="font-mono text-xs">→</span>
          </button>
        </div>

        {applyMsg ? (
          <p className="mt-2 font-mono text-xs text-signal-green">
            ✓ {applyMsg}
          </p>
        ) : null}
        {applyErr ? (
          <p className="mt-2 font-mono text-xs text-signal-red">
            ⚠ {applyErr}
          </p>
        ) : null}

        {serverSnapshot && serverSnapshot.revision > 0 ? (
          <p className="mt-3 label-mono text-ink-soft">
            최근 반영:{" "}
            {serverSnapshot.applied_by_name ??
              serverSnapshot.applied_by_email?.split("@")[0] ??
              "익명"}{" "}
            ·{" "}
            {serverSnapshot.applied_at
              ? formatRelative(new Date(serverSnapshot.applied_at))
              : "—"}{" "}
            · revision {serverSnapshot.revision}
          </p>
        ) : null}
      </div>

      {/* ── Footer ── */}
      <div className="mt-8 pt-4 border-t border-ink-soft/30 flex items-baseline justify-between flex-wrap gap-3">
        <p className="label-mono">
          {lastSavedAt
            ? `✓ 입력 자동 저장됨 — ${formatRelative(lastSavedAt)}`
            : "입력 자동 저장 — draft 는 즉시"}
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

      {/* ── 이력 modal ── */}
      {historyModal ? (
        <FieldHistoryModal
          workspace={workspace}
          field={historyModal.field}
          label={historyModal.label}
          unit={historyModal.unit}
          onClose={() => setHistoryModal(null)}
        />
      ) : null}
    </section>
  );
}

// ─── helpers ───
function stripMeta(c: OpsContext): OpsContext {
  const { updated_at: _u, ...rest } = c;
  void _u;
  return rest;
}

function diffKeys(
  a: OpsContext,
  b: OpsContext,
): Array<keyof OpsContext> {
  const out: Array<keyof OpsContext> = [];
  const keys = new Set<keyof OpsContext>([
    ...(Object.keys(a) as Array<keyof OpsContext>),
    ...(Object.keys(b) as Array<keyof OpsContext>),
  ]);
  keys.delete("updated_at" as keyof OpsContext);
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
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
  onShowHistory,
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
  /** 이력 버튼 클릭 시 호출 */
  onShowHistory?: () => void;
}) {
  const filled = value !== undefined && !Number.isNaN(value);
  // KRW(₩) 는 prefix, 나머지는 suffix
  const isPrefix = unit === "₩";
  // KRW 큰 수 천단위 콤마 표시 (입력 중엔 raw, 비포커스 시 포맷). 단순화: 모든
  // ₩ 필드는 type=text + 콤마 표시; 그 외는 type=number.
  const isCurrency = unit === "₩";

  return (
    <label className="block group">
      <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
        <span className="label-mono">{kicker}</span>
        <span className="label-mono opacity-40">·</span>
        <span className="text-sm font-medium leading-tight">{label}</span>
        {onShowHistory ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onShowHistory();
            }}
            className="ml-auto label-mono border border-ink-soft/50 px-2 py-0.5 hover:border-ink hover:bg-paper-deep hover:text-ink transition-colors inline-flex items-center gap-1"
            title="이 필드의 변경 이력 보기"
          >
            <span aria-hidden="true">⟳</span>
            <span>이력</span>
          </button>
        ) : null}
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

// ─── Goal gap chips — 현재값 vs 목표값 격차 표시 ───
function GoalGapLine({
  gaps,
}: {
  gaps: Array<{
    label: string;
    current: number | undefined;
    goal: number | undefined;
    annualHint?: boolean;
  }>;
}) {
  const chips = gaps
    .map((g) => {
      if (g.current === undefined || g.goal === undefined || g.current <= 0)
        return null;
      const ratio = g.goal / g.current;
      const tone =
        ratio >= 3
          ? "!text-signal-red"
          : ratio >= 1.5
            ? "!text-signal-amber"
            : ratio >= 1
              ? "!text-cobalt"
              : "!text-signal-green";
      const ratioLabel =
        ratio >= 1
          ? `${ratio.toFixed(1)}배${g.annualHint ? " (연말까지)" : ""}`
          : "이미 달성";
      return { key: g.label, label: `${g.label} 격차 ${ratioLabel}`, tone };
    })
    .filter((c): c is { key: string; label: string; tone: string } => c !== null);

  if (chips.length === 0) {
    return (
      <p className="label-mono text-ink-soft/60 mb-3">
        현재 운영 숫자와 목표를 모두 입력하면 격차가 자동 계산됩니다.
      </p>
    );
  }

  return (
    <p className="mb-3 flex items-baseline gap-x-3 gap-y-1 flex-wrap">
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

/**
 * Ops Context Adaptation Engine.
 *
 * 회사 운영 컨디션(OpsContext) 을 분석해 어느 진단 도메인을 강조해야 하는지
 * 규칙 기반으로 산출. 이 결과는:
 *   - 진단 폼 상단 banner 에 노출 ("이번 진단은 A6·A13 영역 우선 점검")
 *   - 워크리스트 task 우선순위 boost (해당 도메인 task 가 accent 강조)
 *   - 향후: 진단 sub-item 정렬·sub_item_responses 가중치 amplifier
 *
 * 디자인 원칙:
 *   - 순수 함수 (입력=OpsContext, 출력=AdaptationOutput) — 사이드이펙트 X
 *   - 규칙 명시적 (RULES 배열) — 새 규칙 추가는 한 줄
 *   - 영유아 EdTech 특화 임계값 (영유아 freemium 5-15%, NRR 85%+, 등)
 *   - 데이터 부족 → 규칙 발화 안 함 (false negative 안전)
 */

import type { OpsContext } from "@/app/diag/[workspace]/_ops-context-section";

export type AdaptSeverity = "high" | "medium" | "low";

export interface AdaptedDomain {
  domain: string; // 'A4', 'A6', etc.
  severity: AdaptSeverity;
  rule_ids: string[];
  reasons: string[];
}

export interface RealismWarning {
  /** 어떤 비교에서 경고가 났는지 */
  metric: string;
  /** 현재값 */
  current: number;
  /** 목표값 */
  goal: number;
  /** ratio (goal/current) */
  ratio: number;
  severity: "high" | "extreme";
  message: string;
}

export interface AdaptationOutput {
  /** severity 내림차순으로 정렬된 강조 domains */
  emphasized: AdaptedDomain[];
  /** 어떤 규칙이라도 발화됐는지 */
  has_signal: boolean;
  /** 목표가 비현실적으로 큰 경우 — 진단 신뢰도 ↓ 경고 */
  realism_warnings: RealismWarning[];
  /** 마지막 평가 시각 (cache 키 등) */
  evaluated_at: string;
}

interface Rule {
  id: string;
  domain: string;
  severity: AdaptSeverity;
  /** 발화 조건 — context 만 보고 boolean 반환. null/undefined 데이터엔 false. */
  fires: (ctx: OpsContext) => boolean;
  /** 사용자에게 보여줄 한국어 사유 */
  reason: string;
}

// ─── 현재 상태 기반 규칙 ───
const STATE_RULES: Rule[] = [
  {
    id: "churn-high",
    domain: "A4",
    severity: "high",
    fires: (c) =>
      c.churn_monthly !== undefined &&
      c.mau !== undefined &&
      c.mau > 0 &&
      c.churn_monthly / c.mau > 0.1,
    reason: "월 이탈률이 10% 초과 — 사용자 활성화·유지(A4) 영역 우선",
  },
  {
    id: "churn-mid",
    domain: "A4",
    severity: "medium",
    fires: (c) =>
      c.churn_monthly !== undefined &&
      c.mau !== undefined &&
      c.mau > 0 &&
      c.churn_monthly / c.mau > 0.05 &&
      c.churn_monthly / c.mau <= 0.1,
    reason: "월 이탈률 5–10% — 사용자 유지(A4) 영역 보강 필요",
  },
  {
    id: "engagement-weak",
    domain: "A4",
    severity: "medium",
    fires: (c) =>
      c.wau !== undefined &&
      c.mau !== undefined &&
      c.mau > 0 &&
      c.wau / c.mau < 0.3,
    reason: "WAU/MAU < 30% — 습관 형성(A4 HABIT) 약함",
  },
  {
    id: "paid-conv-low",
    domain: "A3",
    severity: "high",
    fires: (c) =>
      c.paid_users_monthly !== undefined &&
      c.mau !== undefined &&
      c.mau > 0 &&
      c.paid_users_monthly / c.mau < 0.05,
    reason: "유료 전환율 < 5% — 결정자(교사) ROI(A3) 영역 우선",
  },
  {
    id: "d1-low",
    domain: "A4",
    severity: "high",
    fires: (c) =>
      c.d1_activation_rate !== undefined && c.d1_activation_rate < 30,
    reason: "D1 활성화율 < 30% — 초기 활성화(A4.ACT.D1) critical",
  },
  {
    id: "nrr-weak",
    domain: "A13",
    severity: "high",
    fires: (c) => c.nrr_rate !== undefined && c.nrr_rate < 85,
    reason: "NRR < 85% — CS·NPS·고객성공(A13) 영역 우선",
  },
  {
    id: "nrr-mid",
    domain: "A13",
    severity: "medium",
    fires: (c) =>
      c.nrr_rate !== undefined && c.nrr_rate >= 85 && c.nrr_rate < 100,
    reason: "NRR 85–100% — CS·NPS(A13) 보강 권장",
  },
];

// ─── 목표 격차 기반 규칙 ───
function ratio(goal: number | undefined, current: number | undefined) {
  if (goal === undefined || current === undefined || current <= 0) return null;
  return goal / current;
}

const GOAL_RULES: Rule[] = [
  {
    id: "acq-gap-high",
    domain: "A6",
    severity: "high",
    fires: (c) => {
      const r = ratio(c.goal_new_signups_monthly, c.new_signups_monthly);
      return r !== null && r >= 2;
    },
    reason: "이번 달 신규 가입 목표가 현재의 2배 이상 — 획득 채널(A6) 영역 우선",
  },
  {
    id: "acq-gap-mid",
    domain: "A6",
    severity: "medium",
    fires: (c) => {
      const r = ratio(c.goal_new_signups_monthly, c.new_signups_monthly);
      return r !== null && r >= 1.3 && r < 2;
    },
    reason: "이번 달 신규 가입 목표가 현재의 1.3–2배 — GTM(A6) 가속 권장",
  },
  {
    id: "paid-gap-high",
    domain: "A3",
    severity: "high",
    fires: (c) => {
      const r = ratio(c.goal_paid_users_monthly, c.paid_users_monthly);
      return r !== null && r >= 2;
    },
    reason: "이번 달 유료 사용자 목표가 현재의 2배 이상 — 결정자 ROI(A3) + 매출 retention(A13) 강조",
  },
  {
    id: "annual-members-gap",
    domain: "A6",
    severity: "high",
    fires: (c) => {
      // total_members 우선 (정확) → 없으면 MAU 폴백
      const base = c.total_members ?? c.mau;
      const r = ratio(c.goal_total_members_annual, base);
      return r !== null && r >= 5;
    },
    reason: "올해 누적 회원 목표가 현재 회원의 5배 이상 — 획득 채널(A6) 영역 우선",
  },
  {
    id: "annual-paid-gap",
    domain: "A3",
    severity: "high",
    fires: (c) => {
      const r = ratio(c.goal_paid_subscribers_annual, c.paid_users_monthly);
      return r !== null && r >= 5;
    },
    reason: "올해 유료 구독자 목표가 현재의 5배 이상 — 결정자 ROI(A3)·NRR(A13) 영역",
  },
  {
    id: "plc-focus",
    domain: "A11",
    severity: "medium",
    fires: (c) =>
      (c.goal_plc_monthly !== undefined && c.goal_plc_monthly > 0) ||
      (c.goal_plc_annual !== undefined && c.goal_plc_annual > 0),
    reason: "PLC(학습공동체) 목표 설정 — 팀·문화·커뮤니티(A11) 영역 강조",
  },
];

const ALL_RULES: Rule[] = [...STATE_RULES, ...GOAL_RULES];

// ─── 현실성 체크 ───
/**
 * 목표/현재 ratio 가 너무 크면 진단 신뢰도 ↓.
 * 10배 = high, 100배 = extreme.
 * 영유아 EdTech 운영 1년 사이클에서 합리적 성장은 2-5배. 10배+는 비현실적.
 */
function checkRealism(ctx: OpsContext): RealismWarning[] {
  const out: RealismWarning[] = [];
  const checks: Array<{
    metric: string;
    current: number | undefined;
    goal: number | undefined;
    period: "month" | "year";
  }> = [
    {
      metric: "월 신규 가입",
      current: ctx.new_signups_monthly,
      goal: ctx.goal_new_signups_monthly,
      period: "month",
    },
    {
      metric: "월 유료 사용자",
      current: ctx.paid_users_monthly,
      goal: ctx.goal_paid_users_monthly,
      period: "month",
    },
    {
      metric: "누적 회원",
      current: ctx.total_members ?? ctx.mau,
      goal: ctx.goal_total_members_annual,
      period: "year",
    },
    {
      metric: "유료 구독자",
      current: ctx.paid_users_monthly,
      goal: ctx.goal_paid_subscribers_annual,
      period: "year",
    },
  ];

  for (const c of checks) {
    if (c.current === undefined || c.goal === undefined || c.current <= 0)
      continue;
    const r = c.goal / c.current;
    // 월 목표 vs 현재 → 5배+ 부터 high, 20배+ 부터 extreme
    // 연 목표 vs 현재 → 10배+ 부터 high, 50배+ 부터 extreme
    const threshHigh = c.period === "month" ? 5 : 10;
    const threshExtreme = c.period === "month" ? 20 : 50;
    if (r >= threshExtreme) {
      out.push({
        metric: c.metric,
        current: c.current,
        goal: c.goal,
        ratio: r,
        severity: "extreme",
        message: `${c.metric} 목표가 현재의 ${r.toFixed(1)}배 — 1${c.period === "month" ? "개월" : "년"} 내 달성 가능성 매우 낮음. 진단 결과 해석 시 목표 재현실화 권장.`,
      });
    } else if (r >= threshHigh) {
      out.push({
        metric: c.metric,
        current: c.current,
        goal: c.goal,
        ratio: r,
        severity: "high",
        message: `${c.metric} 목표가 현재의 ${r.toFixed(1)}배 — 도전적. 진단 점수 해석 시 격차 인지 권장.`,
      });
    }
  }
  return out;
}

// ─── 메인 함수 ───
export function computeOpsContextAdaptation(
  ctx: OpsContext | null | undefined,
): AdaptationOutput {
  if (!ctx) {
    return {
      emphasized: [],
      has_signal: false,
      realism_warnings: [],
      evaluated_at: new Date().toISOString(),
    };
  }

  const firedRules = ALL_RULES.filter((r) => {
    try {
      return r.fires(ctx);
    } catch {
      return false;
    }
  });

  // domain 별로 묶기
  const byDomain = new Map<string, AdaptedDomain>();
  for (const r of firedRules) {
    const existing = byDomain.get(r.domain);
    if (existing) {
      existing.rule_ids.push(r.id);
      existing.reasons.push(r.reason);
      // severity 가 더 높으면 격상
      if (severityRank(r.severity) > severityRank(existing.severity)) {
        existing.severity = r.severity;
      }
    } else {
      byDomain.set(r.domain, {
        domain: r.domain,
        severity: r.severity,
        rule_ids: [r.id],
        reasons: [r.reason],
      });
    }
  }

  const emphasized = Array.from(byDomain.values()).sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );

  const realism_warnings = checkRealism(ctx);

  return {
    emphasized,
    has_signal: emphasized.length > 0 || realism_warnings.length > 0,
    realism_warnings,
    evaluated_at: new Date().toISOString(),
  };
}

function severityRank(s: AdaptSeverity): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// ─── 헬퍼 — UI 에서 도메인이 강조됐는지 빠르게 확인 ───
export function isDomainEmphasized(
  output: AdaptationOutput,
  domainCode: string,
): AdaptedDomain | null {
  return output.emphasized.find((d) => d.domain === domainCode) ?? null;
}

// ─── localStorage 헬퍼 (client-side reader) ───
const STORAGE_KEY_PREFIX = "kso-ops-context-";
export function loadOpsContextFromLocalStorage(
  workspace: string,
): OpsContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${workspace}`);
    return raw ? (JSON.parse(raw) as OpsContext) : null;
  } catch {
    return null;
  }
}

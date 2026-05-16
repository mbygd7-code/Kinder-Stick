"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import type {
  Domain,
  FrameworkConfig,
  SubItem,
} from "@/lib/framework/loader";
import { EvidenceInputPanel } from "./_evidence-input";
import { SubItemHelpPopover } from "./_sub-item-help";
import { useDiagnosisProfile } from "./_diagnosis-profile-provider";
import type {
  AddedSubItem,
  DiagnosisProfile,
  ReferenceInfo,
  SubItemAdaptation,
} from "@/lib/diagnosis-profile/types";

type Tab = "context" | "critical" | "optional";

// ============================================================
// Types
// ============================================================

type Belief = 1 | 2 | 3 | 4 | 5;
type Evidence = 1 | 2 | 3 | 4 | 5;

/**
 * 업로드된 증거 파일 메타.
 * Supabase Storage 의 public URL 만 보관 (실제 파일은 storage bucket).
 */
export interface EvidenceFile {
  url: string;        // Supabase Storage public URL
  name: string;       // 원본 파일명
  size: number;       // bytes
  mime: string;       // image/png, application/pdf, ...
  uploaded_at: string; // ISO
}

/**
 * AI 분석 결과 — 입력된 actual_value · notes · 업로드된 파일을
 * Claude 가 검토한 뒤 산출하는 구조화 요약.
 */
export interface EvidenceAIAnalysis {
  summary: string;            // 1-3문장 한국어 요약
  suggested_bucket: number | null; // 1-5, 측정값에서 AI 가 추론한 1-5
  confidence: number;         // 0..1
  flags: string[];            // ["data_mismatch", "no_proof", "vague_text"] 등
  analyzed_at: string;        // ISO
  model: string;              // "claude-haiku-4-5-20251001"
}

interface Response {
  belief?: Belief;
  evidence?: Evidence;
  na?: boolean; // "측정 안 함" 명시 — evidence 자동으로 1로 맵핑되어 점수 계산되지만 UI에선 별도 표시

  // ── 증거 강화 (Evidence-Based Diagnosis) ──
  /** 실제 측정값 (e.g., "38" for Sean Ellis 38%). 자유 텍스트 — 숫자/단위 자체 입력 */
  actual_value?: string;
  /** 컨텍스트 노트 — 어디서 측정했나, 표본 크기, 시점 등 */
  notes?: string;
  /** 업로드된 증거 파일들 (스크린샷·CSV·PDF) */
  evidence_files?: EvidenceFile[];
  /** AI 가 위 정보를 분석한 결과 — 요약 + 추론 bucket + flags */
  ai_analysis?: EvidenceAIAnalysis;
}

type ResponsesMap = Record<string, Response>;

interface Context {
  role: string;
  perspective: string;
  stage: "closed_beta" | "open_beta" | "ga_early" | "ga_growth" | "ga_scale";
  team_size: string;
}

interface PersistShape {
  context: Context;
  responses: ResponsesMap;
  v: number; // schema version for migration safety
}

const DEFAULT_CONTEXT: Context = {
  role: "",
  perspective: "founder",
  stage: "open_beta",
  team_size: "",
};

/**
 * 회원 프로필의 team → 진단 폼의 perspective 매핑.
 * director = 대표·경영진, planning/design/engineering = 제품·엔지니어링,
 * marketing = 마케팅·영업·CS, operations = 운영·재무.
 */
const TEAM_TO_PERSPECTIVE: Record<string, Context["perspective"]> = {
  director: "founder",
  planning: "product",
  design: "product",
  engineering: "product",
  marketing: "growth",
  operations: "ops",
};

/** 회원 프로필의 team → "역할" 필드 자유 기재 prefill 라벨. */
const TEAM_TO_ROLE_LABEL: Record<string, string> = {
  director: "대표·경영진",
  planning: "기획팀",
  design: "디자인팀",
  engineering: "개발팀",
  marketing: "마케팅팀",
  operations: "운영팀",
};

const STORAGE_VERSION = 1;

// ============================================================
// Component
// ============================================================

export interface DiagnosisSubmitResult {
  ok: boolean;
  session_id?: string;
  respondent_num?: number;
  result?: Record<string, unknown>;
  message?: string;
}

export function DiagnosisForm({
  workspace,
  framework,
  onSubmitted,
  redirectAfterSubmit = true,
}: {
  workspace: string;
  framework: FrameworkConfig;
  /** 제출 성공 시 콜백 — 통합 페이지에서 결과를 같은 페이지 인라인 표시할 때 사용 */
  onSubmitted?: (result: DiagnosisSubmitResult) => void;
  /** false 이면 제출 후 router.push 하지 않음 (callback 만 호출) */
  redirectAfterSubmit?: boolean;
}) {
  const router = useRouter();
  const storageKey = `kso-diag-${workspace}`;

  // Adaptation profile — OpsContext 기반 T1/T2/T3 + inactive
  const {
    profile,
    rejectedAddedCodes,
    rejectAdded,
    unrejectAdded,
    expandedInactiveCodes,
    toggleInactive,
  } = useDiagnosisProfile();

  const [context, setContext] = useState<Context>(DEFAULT_CONTEXT);
  const [responses, setResponses] = useState<ResponsesMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [submitting, startSubmitting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ---- Hydrate from localStorage ----
  useEffect(() => {
    let restoredRole = "";
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistShape;
        if (parsed.v === STORAGE_VERSION) {
          setContext(parsed.context);
          setResponses(parsed.responses);
          restoredRole = parsed.context?.role ?? "";
        }
      }
    } catch {
      // ignore corrupt storage
    } finally {
      setHydrated(true);
    }

    // 로그인된 사용자가 있으면 회원가입 정보로 role·perspective 미리 채움 (수정 가능).
    // 사용자가 이미 입력한 값이 있으면 (restoredRole 비어있지 않으면) 덮어쓰지 않음.
    if (!restoredRole) {
      void (async () => {
        try {
          const res = await fetch("/api/auth/pin/me");
          if (!res.ok) return;
          const data = (await res.json()) as {
            profile: {
              display_name: string | null;
              team: string | null;
              email: string;
            } | null;
          };
          const p = data.profile;
          if (!p) return;
          const teamLabel = p.team ? TEAM_TO_ROLE_LABEL[p.team] : null;
          const prefilledRole =
            p.display_name && teamLabel
              ? `${p.display_name} · ${teamLabel}`
              : (p.display_name ?? teamLabel ?? "");
          const prefilledPerspective: Context["perspective"] = p.team
            ? (TEAM_TO_PERSPECTIVE[p.team] ?? "founder")
            : "founder";
          setContext((c) => ({
            ...c,
            // 이미 사용자가 손댄 값은 절대 덮어쓰지 않음 (수정 가능 보장)
            role: c.role || prefilledRole,
            perspective:
              c.perspective === DEFAULT_CONTEXT.perspective
                ? prefilledPerspective
                : c.perspective,
          }));
        } catch {
          // 인증 안 됨 / 네트워크 실패 — 그대로 빈 상태로 둠
        }
      })();
    }
  }, [storageKey]);

  // ---- Persist on change ----
  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistShape = {
      context,
      responses,
      v: STORAGE_VERSION,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // localStorage quota or disabled — ignore
    }
  }, [hydrated, storageKey, context, responses]);

  // ---- Compute progress ----
  // 모든 카드 (활성 + 비활성 + 추가됨 — 거부된 추가는 제외)
  const allSubItems = useMemo(
    () => framework.domains.flatMap((d) => d.groups.flatMap((g) => g.sub_items)),
    [framework],
  );

  // 진행률 분모: 활성 + 추가됨(거부 제외). 비활성은 분모에서도 제외.
  const totalForProgress = useMemo(() => {
    const inactiveCount = Object.values(profile.sub_item_adaptations).filter(
      (a) => a.state === "inactive",
    ).length;
    const addedKept = profile.added_sub_items.filter(
      (a) => !rejectedAddedCodes.has(a.code),
    ).length;
    return allSubItems.length - inactiveCount + addedKept;
  }, [allSubItems, profile, rejectedAddedCodes]);

  const completed = useMemo(() => {
    // 기본 sub-items: 비활성은 제외
    const baseAnswered = allSubItems.filter((s) => {
      if (profile.sub_item_adaptations[s.code]?.state === "inactive")
        return false;
      const r = responses[s.code];
      return r && r.belief && (r.evidence || r.na);
    }).length;
    // 추가 sub-items: 거부 제외, 응답 있으면 카운트
    const addedAnswered = profile.added_sub_items.filter((a) => {
      if (rejectedAddedCodes.has(a.code)) return false;
      const r = responses[a.code];
      return r && r.belief && (r.evidence || r.na);
    }).length;
    return baseAnswered + addedAnswered;
  }, [allSubItems, responses, profile, rejectedAddedCodes]);

  const total = totalForProgress;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const ready = completed >= 1; // 최소 1개 응답 시 제출 허용 (전체 응답을 강제하지 않음)
  const fullyComplete = completed === total;

  // ---- Stage groupings (Critical-first UX) ----
  const criticalDomains = useMemo(
    () => framework.domains.filter((d) => d.tier === "critical"),
    [framework],
  );
  const optionalDomains = useMemo(
    () => framework.domains.filter((d) => d.tier !== "critical"),
    [framework],
  );

  const criticalSubs = useMemo(
    () => criticalDomains.flatMap((d) => d.groups.flatMap((g) => g.sub_items)),
    [criticalDomains],
  );
  const optionalSubs = useMemo(
    () => optionalDomains.flatMap((d) => d.groups.flatMap((g) => g.sub_items)),
    [optionalDomains],
  );

  const criticalAnswered = criticalSubs.filter((s) => {
    const r = responses[s.code];
    return r && r.belief && (r.evidence || r.na);
  }).length;
  const optionalAnswered = optionalSubs.filter((s) => {
    const r = responses[s.code];
    return r && r.belief && (r.evidence || r.na);
  }).length;

  const contextFilled = !!context.role.trim();

  const [tab, setTab] = useState<Tab>("context");
  // 처음 진입 시 context 미작성 → context 탭, 작성됐으면 critical
  useEffect(() => {
    if (!hydrated) return;
    if (contextFilled && tab === "context" && criticalAnswered === 0) {
      setTab("critical");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // ---- Handlers ----
  function setResponse(code: string, patch: Partial<Response>) {
    setResponses((prev) => ({
      ...prev,
      [code]: { ...prev[code], ...patch },
    }));
  }

  async function submit() {
    setError(null);
    startSubmitting(async () => {
      const recordedAt = new Date().toISOString();
      // 거부된 추가 카드는 profile 에서 제외해 서버 점수 산정에 반영 X
      const appliedProfile = {
        ...profile,
        added_sub_items: profile.added_sub_items.filter(
          (a) => !rejectedAddedCodes.has(a.code),
        ),
      };
      const payload = {
        workspace_id: workspace,
        context,
        responses: Object.fromEntries(
          Object.entries(responses)
            .filter(([, v]) => v && v.belief && (v.evidence || v.na))
            .map(([k, v]) => [
              k,
              {
                belief: v.belief,
                evidence: v.na ? null : v.evidence,
                na: !!v.na,
                evidence_recorded_at: recordedAt,
                // ── 증거 강화 필드 ──
                actual_value: v.actual_value?.trim() || undefined,
                notes: v.notes?.trim() || undefined,
                evidence_files:
                  v.evidence_files && v.evidence_files.length > 0
                    ? v.evidence_files
                    : undefined,
                ai_analysis: v.ai_analysis,
              },
            ]),
        ),
        // 회사 컨텍스트 기반 진단 적응 프로필 — T1/T2/T3 + inactive
        applied_profile: appliedProfile,
      };

      try {
        const res = await fetch("/api/diagnosis/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message ?? "제출 실패");
          if (onSubmitted) {
            onSubmitted({ ok: false, message: json.message });
          }
          return;
        }
        // 콜백 우선 — 통합 페이지에서 같은 자리에 결과 인라인 노출용
        if (onSubmitted) {
          onSubmitted({
            ok: true,
            session_id: json.session_id,
            respondent_num: json.respondent_num,
            result: json.result,
          });
        }
        if (redirectAfterSubmit) {
          // localStorage 보존 (이력 보기용). 통합 홈으로 이동 (진단→운영 자연 흐름)
          router.push(
            `/diag/${workspace}/home?session=${encodeURIComponent(json.session_id ?? "")}&respondent=${json.respondent_num ?? ""}`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function clearAll() {
    if (!confirm("이 진단 카드의 모든 응답을 지웁니다. 계속할까요?")) return;
    setContext(DEFAULT_CONTEXT);
    setResponses({});
    localStorage.removeItem(storageKey);
  }

  return (
    <main className="min-h-dvh w-full pb-32">
      {/* ==================== MASTHEAD ==================== */}
      <header className="border-b-2 border-ink">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <a href="/diag" className="kicker hover:text-ink">
              ← Domain Map
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              workspace · {workspace}
            </span>
          </div>
          <span className="label-mono">DIAGNOSIS / RESPONSE</span>
        </div>
      </header>

      {/* ==================== HERO ==================== */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-4">No. 04 · 분기 진단</p>
        <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] tracking-tight">
          진단 응답
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-ink-soft">
          단계: <strong>① 컨텍스트 → ② Critical {criticalDomains.length}개 →
          ③ Optional {optionalDomains.length}개</strong>. Critical만으로도 제출
          가능합니다. Belief(5점) × Evidence(5단계). 진척은 자동 저장돼
          이어서 답할 수 있습니다.
        </p>
      </section>

      {/* ==================== TAB NAV (sticky) ==================== */}
      <nav className="sticky top-0 z-20 border-b border-ink-soft paper-bg">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 py-3 flex items-stretch gap-1 overflow-x-auto">
          <TabButton
            active={tab === "context"}
            onClick={() => setTab("context")}
            label="① Context"
            sub={contextFilled ? "✓ filled" : "필수"}
            tone={contextFilled ? "green" : "amber"}
          />
          <TabButton
            active={tab === "critical"}
            onClick={() => setTab("critical")}
            label={`② Critical · ${criticalDomains.length}`}
            sub={`${criticalAnswered} / ${criticalSubs.length}`}
            tone={
              criticalAnswered === criticalSubs.length
                ? "green"
                : criticalAnswered > 0
                  ? "amber"
                  : undefined
            }
          />
          <TabButton
            active={tab === "optional"}
            onClick={() => setTab("optional")}
            label={`③ Optional · ${optionalDomains.length}`}
            sub={`${optionalAnswered} / ${optionalSubs.length}`}
            tone={
              optionalAnswered === optionalSubs.length && optionalSubs.length > 0
                ? "green"
                : optionalAnswered > 0
                  ? "amber"
                  : undefined
            }
          />
        </div>
      </nav>

      {/* ==================== TAB BODY ==================== */}
      {tab === "context" ? (
        <ContextStage
          context={context}
          setContext={setContext}
          onContinue={() => setTab("critical")}
        />
      ) : null}

      {tab === "critical" ? (
        <DomainStage
          workspace={workspace}
          title="Critical Domains"
          subtitle="실패 확률에 가장 강하게 기여하는 8개 영역. 모두 답할 것을 권장."
          domains={criticalDomains}
          responses={responses}
          setResponse={setResponse}
          onContinue={() => setTab("optional")}
          continueLabel="다음 — Optional →"
          profile={profile}
          rejectedAddedCodes={rejectedAddedCodes}
          rejectAdded={rejectAdded}
          unrejectAdded={unrejectAdded}
          expandedInactiveCodes={expandedInactiveCodes}
          toggleInactive={toggleInactive}
        />
      ) : null}

      {tab === "optional" ? (
        <DomainStage
          workspace={workspace}
          title="Important + Supporting"
          subtitle="가중치는 낮지만 운영 OS의 균형을 잡는 6개 영역. 시간이 없으면 건너뛰어도 좋습니다."
          domains={optionalDomains}
          responses={responses}
          setResponse={setResponse}
          onContinue={() => setTab("critical")}
          continueLabel="← Critical 로 돌아가기"
          profile={profile}
          rejectedAddedCodes={rejectedAddedCodes}
          rejectAdded={rejectAdded}
          unrejectAdded={unrejectAdded}
          expandedInactiveCodes={expandedInactiveCodes}
          toggleInactive={toggleInactive}
        />
      ) : null}

      {/* ==================== STICKY SUBMIT BAR ==================== */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t-2 border-ink paper-bg">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 py-4 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-1">
                <span className="kicker">progress</span>
                <span className="font-mono text-xs text-ink-soft">
                  {completed} / {total} ({pct}%)
                  {fullyComplete ? " · all complete" : ""}
                </span>
              </div>
              <div className="bar-track">
                <div
                  className={`bar-fill ${
                    pct >= 100 ? "green" : pct >= 50 ? "amber" : "accent"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={clearAll}
              className="btn-secondary !py-3 !px-4 text-sm"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!ready || submitting}
              className="btn-primary !py-3 !px-5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "제출 중…" : "제출 → 결과 보기"}
              <span className="font-mono text-xs">→</span>
            </button>
          </div>
        </div>
        {error ? (
          <div className="border-t border-signal-red bg-soft-red text-signal-red font-mono text-xs px-6 sm:px-10 py-2">
            <span className="font-mono text-[10px] uppercase tracking-widest mr-1">오류</span> {error}
          </div>
        ) : null}
      </div>
    </main>
  );
}

// ============================================================
// Sub-components
// ============================================================

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label-mono mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function TabButton({
  active,
  onClick,
  label,
  sub,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  tone?: "green" | "amber";
}) {
  const subColor =
    tone === "green"
      ? "text-signal-green"
      : tone === "amber"
        ? "text-signal-amber"
        : "text-ink-soft";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-[140px] text-left px-4 py-2 border-2 transition ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-ink-soft hover:border-ink"
      }`}
    >
      <p className={`font-display text-base leading-tight ${active ? "text-paper" : ""}`}>
        {label}
      </p>
      <p
        className={`label-mono mt-0.5 ${
          active ? "!text-paper" : subColor
        }`}
      >
        {sub}
      </p>
    </button>
  );
}

function ContextStage({
  context,
  setContext,
  onContinue,
}: {
  context: Context;
  setContext: Dispatch<SetStateAction<Context>>;
  onContinue: () => void;
}) {
  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8">
      <div className="area-card">
        <p className="kicker mb-2">§ Stage 1 · Respondent context</p>
        <h2 className="font-display text-3xl mb-4">응답자 정보</h2>
        <p className="text-ink-soft mb-5 text-sm">
          역할과 출시 단계는 진단·우선순위·실패확률 산정에 직접 사용됩니다.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="역할 (자유 기재)">
            <input
              type="text"
              placeholder="예: 대표/CEO, 제품 책임자, 운영 리드 ..."
              value={context.role}
              onChange={(e) =>
                setContext((c) => ({ ...c, role: e.target.value }))
              }
              className="evidence-input"
            />
          </Field>
          <Field label="관점">
            <select
              value={context.perspective}
              onChange={(e) =>
                setContext((c) => ({ ...c, perspective: e.target.value }))
              }
              className="evidence-input"
            >
              <option value="founder">대표·경영진</option>
              <option value="product">제품·엔지니어링</option>
              <option value="growth">마케팅·영업·CS</option>
              <option value="ops">운영·재무</option>
              <option value="advisor">자문·외부</option>
            </select>
          </Field>
          <Field label="제품 출시 단계 (우선순위 산정에 사용)">
            <select
              value={context.stage}
              onChange={(e) =>
                setContext((c) => ({
                  ...c,
                  stage: e.target.value as Context["stage"],
                }))
              }
              className="evidence-input"
            >
              <option value="closed_beta">비공개 베타 (초청 사용자)</option>
              <option value="open_beta">공개 베타 (PMF 검증)</option>
              <option value="ga_early">정식 출시 (0–6개월)</option>
              <option value="ga_growth">성장기 (6–24개월)</option>
              <option value="ga_scale">확장기 (24개월+)</option>
            </select>
          </Field>
          <Field label="팀 규모 (선택)">
            <input
              type="text"
              placeholder="예: 6명"
              value={context.team_size}
              onChange={(e) =>
                setContext((c) => ({ ...c, team_size: e.target.value }))
              }
              className="evidence-input"
            />
          </Field>
        </div>
        <div className="mt-6 dotted-rule pt-4 flex justify-end">
          <button type="button" onClick={onContinue} className="btn-primary">
            다음 — Critical 8개 시작
            <span className="font-mono text-xs">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function DomainStage({
  workspace,
  title,
  subtitle,
  domains,
  responses,
  setResponse,
  onContinue,
  continueLabel,
  profile,
  rejectedAddedCodes,
  rejectAdded,
  unrejectAdded,
  expandedInactiveCodes,
  toggleInactive,
}: {
  workspace: string;
  title: string;
  subtitle: string;
  domains: Domain[];
  responses: ResponsesMap;
  setResponse: (code: string, patch: Partial<Response>) => void;
  onContinue: () => void;
  continueLabel: string;
  profile: DiagnosisProfile;
  rejectedAddedCodes: Set<string>;
  rejectAdded: (code: string) => void;
  unrejectAdded: (code: string) => void;
  expandedInactiveCodes: Set<string>;
  toggleInactive: (code: string) => void;
}) {
  return (
    <>
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8">
        <p className="kicker mb-1">§ {title}</p>
        <h2 className="font-display text-3xl">{domains.length} domains</h2>
        <p className="mt-2 text-ink-soft text-sm max-w-2xl">{subtitle}</p>
      </section>
      <div className="max-w-5xl mx-auto px-6 sm:px-10 mt-8 space-y-12">
        {domains.map((d) => (
          <DomainSection
            key={d.code}
            workspace={workspace}
            domain={d}
            responses={responses}
            setResponse={setResponse}
            profile={profile}
            rejectedAddedCodes={rejectedAddedCodes}
            rejectAdded={rejectAdded}
            unrejectAdded={unrejectAdded}
            expandedInactiveCodes={expandedInactiveCodes}
            toggleInactive={toggleInactive}
          />
        ))}
      </div>
      <div className="max-w-5xl mx-auto px-6 sm:px-10 mt-10 flex justify-end">
        <button type="button" onClick={onContinue} className="btn-secondary">
          {continueLabel}
        </button>
      </div>
    </>
  );
}

function tierTagClass(tier: SubItem["tier"]): string {
  switch (tier) {
    case "critical":
      return "tag-accent";
    case "important":
      return "tag-gold";
    case "supporting":
      return "tag";
  }
}

function DomainSection({
  workspace,
  domain,
  responses,
  setResponse,
  profile,
  rejectedAddedCodes,
  rejectAdded,
  unrejectAdded,
  expandedInactiveCodes,
  toggleInactive,
}: {
  workspace: string;
  domain: Domain;
  responses: ResponsesMap;
  setResponse: (code: string, patch: Partial<Response>) => void;
  profile: DiagnosisProfile;
  rejectedAddedCodes: Set<string>;
  rejectAdded: (code: string) => void;
  unrejectAdded: (code: string) => void;
  expandedInactiveCodes: Set<string>;
  toggleInactive: (code: string) => void;
}) {
  const subs = domain.groups.flatMap((g) => g.sub_items);
  // 비활성 카드는 카운트에서 제외 (UI 진행률 정렬 위해)
  const visibleSubs = subs.filter(
    (s) => profile.sub_item_adaptations[s.code]?.state !== "inactive",
  );
  const answeredBase = visibleSubs.filter((s) => {
    const r = responses[s.code];
    return r && r.belief && (r.evidence || r.na);
  }).length;
  // 이 도메인에 속한 추가 카드 (거부된 것 제외)
  const addedForDomain = profile.added_sub_items.filter(
    (a) => a.domain === domain.code && !rejectedAddedCodes.has(a.code),
  );
  const answeredAdded = addedForDomain.filter((a) => {
    const r = responses[a.code];
    return r && r.belief && (r.evidence || r.na);
  }).length;
  const answered = answeredBase + answeredAdded;
  const total = visibleSubs.length + addedForDomain.length;
  // 비활성된 카드 수 (사용자에게 안내)
  const inactiveSubs = subs.filter(
    (s) => profile.sub_item_adaptations[s.code]?.state === "inactive",
  );
  // 가중치 multiplier
  const weightMul = profile.weight_multipliers[domain.code] ?? 1.0;

  return (
    <section
      id={`domain-${domain.code}`}
      data-domain={domain.code}
      className="border-t border-ink-soft pt-8 transition-all"
    >
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <span className="kicker">
            <span className="section-num">No. </span>
            {domain.code}
          </span>
          <h2 className="mt-1 font-display text-3xl leading-tight">
            {domain.name_ko}
          </h2>
          <p className="label-mono">{domain.name_en}</p>
        </div>
        <div className="text-right">
          <span className="font-mono text-xs">
            {answered} / {total}
          </span>
          <p className="label-mono">
            가중치 {domain.weight}%
            {weightMul !== 1.0 ? (
              <span className="text-accent">
                {" "}
                · ×{weightMul.toFixed(2)} (회사 컨텍스트 강조)
              </span>
            ) : null}{" "}
            · {domain.tier}
          </p>
        </div>
      </header>

      {subs.length === 0 ? (
        <div className="mt-4 note-box">
          이 도메인은 아직 sub-item이 시드되지 않았습니다 (확장 가이드에 명시된
          항목을 추가 시드하면 활성화).
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {/* 활성 sub-items */}
          {visibleSubs.map((s) => (
            <SubItemForm
              key={s.code}
              workspace={workspace}
              sub={s}
              domain={domain}
              response={responses[s.code]}
              onChange={(patch) => setResponse(s.code, patch)}
              referenceInfo={profile.reference_info[s.code]}
            />
          ))}

          {/* 비활성 카드 — 사용자 혼란 방지를 위해 화면에서 숨김 처리.
              내부 데이터/adaptation 은 그대로 유지되며 결과/통계에는 영향 없음.
              필요 시 inactiveSubs.map(...) 블록을 복원하면 다시 노출됩니다. */}

          {/* T3 추가 카드 — "추가됨" 배지 + 거부 ✕ */}
          {addedForDomain.map((a) => (
            <AddedSubItemForm
              key={a.code}
              added={a}
              response={responses[a.code]}
              onChange={(patch) => setResponse(a.code, patch)}
              onReject={() => rejectAdded(a.code)}
            />
          ))}

          {/* 거부된 추가 카드 복구 안내 */}
          {profile.added_sub_items
            .filter(
              (a) =>
                a.domain === domain.code && rejectedAddedCodes.has(a.code),
            )
            .map((a) => (
              <div
                key={a.code}
                className="border border-dashed border-ink-soft px-4 py-3 flex items-center justify-between gap-3"
              >
                <p className="text-xs text-ink-soft">
                  거부됨 — <span className="font-mono">{a.code}</span> ·{" "}
                  {a.belief_q.slice(0, 30)}…
                </p>
                <button
                  type="button"
                  onClick={() => unrejectAdded(a.code)}
                  className="text-xs underline hover:text-ink"
                >
                  복구
                </button>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

function SubItemForm({
  workspace,
  sub,
  domain,
  response,
  onChange,
  referenceInfo,
}: {
  workspace: string;
  sub: SubItem;
  domain: Domain;
  response: Response | undefined;
  onChange: (patch: Partial<Response>) => void;
  referenceInfo?: ReferenceInfo;
}) {
  const beliefVal = response?.belief;
  const evidenceVal = response?.evidence;
  const na = !!response?.na;

  return (
    <article className="area-card">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="font-mono text-xs text-ink-soft">{sub.code}</span>
        <div className="flex items-center gap-2">
          <span className={`tag ${tierTagClass(sub.tier)}`}>
            {sub.tier.toUpperCase()}
          </span>
          <SubItemHelpPopover sub={sub} domain={domain} />
        </div>
      </header>

      {/* T2 — 참고 정보 박스 (보편 / 귀사 컨텍스트 / 벤치마크) */}
      {referenceInfo ? <ReferenceInfoBox info={referenceInfo} /> : null}

      {/* BELIEF */}
      <div className="mt-3">
        <p className="font-display text-lg leading-snug">{sub.belief.q}</p>
        {sub.belief.help ? (
          <p className="mt-1 text-sm text-ink-soft">{sub.belief.help}</p>
        ) : null}
        <div className="mt-3 grid grid-cols-5 gap-2">
          {sub.belief.anchors.map((label, i) => {
            const v = (i + 1) as Belief;
            const selected = beliefVal === v;
            return (
              <button
                type="button"
                key={i}
                onClick={() => onChange({ belief: v })}
                className={`likert-option ${selected ? "selected" : ""}`}
              >
                <span className="num">{v}</span>
                <span className="label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* EVIDENCE */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="kicker">Evidence</p>
          {sub.evidence.kpi_source ? (
            <span className="label-mono">
              kpi: {sub.evidence.kpi_source}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm">{sub.evidence.q}</p>
        {sub.evidence.options ? (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-5 gap-2">
            {sub.evidence.options.map((opt) => {
              const selected = !na && evidenceVal === opt.v;
              return (
                <button
                  type="button"
                  key={opt.v}
                  onClick={() =>
                    onChange({ evidence: opt.v as Evidence, na: false })
                  }
                  className={`likert-option ${selected ? "selected" : ""}`}
                >
                  <span className="num">{opt.v}</span>
                  <span className="label">{opt.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => onChange({ na: !na, evidence: undefined })}
          className={`mt-2 text-xs font-mono underline-offset-2 ${
            na ? "text-accent underline" : "text-ink-soft hover:text-ink"
          }`}
        >
          {na
            ? "✓ 측정/기록 없음 — 데이터 부족으로 표시 (선택 해제하기)"
            : "측정/기록 없음으로 표시"}
        </button>
      </div>

      {/* EVIDENCE INPUT — 실측 값/문서로 조작 방지 + AI 자동 분석 */}
      {!na ? (
        <EvidenceInputPanel
          workspace={workspace}
          sub={sub}
          state={{
            actual_value: response?.actual_value,
            notes: response?.notes,
            evidence_files: response?.evidence_files,
            ai_analysis: response?.ai_analysis,
          }}
          onChange={(patch) => onChange(patch)}
          selectedBucket={evidenceVal}
        />
      ) : null}

      {/* CITATION */}
      <p className="mt-4 dotted-rule pt-3 label-mono">
        근거: {sub.citation}
      </p>
    </article>
  );
}

// ============================================================
// T2 · Reference Info Box — 카드 상단에 보편/컨텍스트/벤치마크 3-layer 정보
// ============================================================

function ReferenceInfoBox({ info }: { info: ReferenceInfo }) {
  if (!info.standard && !info.context && !info.benchmark) return null;
  return (
    <div className="mt-3 border-l-2 border-accent pl-3 py-1 space-y-1 bg-soft-accent/10">
      <p className="kicker !text-accent">참고 정보</p>
      {info.standard ? (
        <p className="text-xs">
          <span className="label-mono mr-1">보편 기준</span>
          {info.standard}
        </p>
      ) : null}
      {info.context ? (
        <p className="text-xs">
          <span className="label-mono mr-1">귀사 컨텍스트</span>
          {info.context}
        </p>
      ) : null}
      {info.benchmark ? (
        <p className="text-xs">
          <span className="label-mono mr-1">벤치마크</span>
          {info.benchmark}
        </p>
      ) : null}
    </div>
  );
}

// ============================================================
// Inactive Collapsed Card — 비활성 sub-item 의 접힘 상태
// ============================================================

function InactiveCollapsedCard({
  sub,
  adaptation,
  onExpand,
}: {
  sub: SubItem;
  adaptation: SubItemAdaptation;
  onExpand: () => void;
}) {
  return (
    <article className="border border-dashed border-ink-soft bg-soft-gray/20 px-5 py-4">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="font-mono text-xs text-ink-soft">
          {sub.code} · <span className="text-signal-amber">비활성</span>
        </span>
        <span className="label-mono">이번 분기 우선순위 낮음</span>
      </header>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        <span className="text-ink">ⓘ {adaptation.reason}</span>
        {adaptation.reactivation_when ? (
          <>
            <br />
            <span className="text-xs">↻ {adaptation.reactivation_when}</span>
          </>
        ) : null}
      </p>
      <button
        type="button"
        onClick={onExpand}
        className="mt-3 text-xs font-mono underline hover:text-ink"
      >
        + 펼쳐서 답하기 (점수 페널티 없음)
      </button>
    </article>
  );
}

// ============================================================
// Added SubItem Form — T3 회사 특수 카드
// ============================================================

function AddedSubItemForm({
  added,
  response,
  onChange,
  onReject,
}: {
  added: AddedSubItem;
  response: Response | undefined;
  onChange: (patch: Partial<Response>) => void;
  onReject: () => void;
}) {
  const beliefVal = response?.belief;
  const evidenceVal = response?.evidence;
  const na = !!response?.na;

  return (
    <article className="area-card border-2 border-accent relative">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-ink-soft">{added.code}</span>
          <span className="tag bg-accent text-paper px-2 py-0.5 text-[10px] font-mono">
            추가됨
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`tag ${tierTagClass(added.tier)}`}>
            {added.tier.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={onReject}
            title="이 카드 거부하기"
            className="w-6 h-6 flex items-center justify-center border border-ink-soft hover:border-signal-red hover:text-signal-red text-sm leading-none"
          >
            ✕
          </button>
        </div>
      </header>

      {/* 추가 사유 */}
      <div className="mt-2 border-l-2 border-accent pl-3 py-1">
        <p className="kicker !text-accent">왜 이 카드가 추가됐나</p>
        <p className="text-xs mt-1">{added.added_reason}</p>
      </div>

      {/* BELIEF */}
      <div className="mt-4">
        <p className="font-display text-lg leading-snug">{added.belief_q}</p>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {added.belief_anchors.map((label, i) => {
            const v = (i + 1) as Belief;
            const selected = beliefVal === v;
            return (
              <button
                type="button"
                key={i}
                onClick={() => onChange({ belief: v })}
                className={`likert-option ${selected ? "selected" : ""}`}
              >
                <span className="num">{v}</span>
                <span className="label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* EVIDENCE */}
      <div className="mt-5">
        <p className="kicker">Evidence</p>
        <p className="mt-1 text-sm">{added.evidence_q}</p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-5 gap-2">
          {added.evidence_options.map((opt) => {
            const selected = !na && evidenceVal === opt.v;
            return (
              <button
                type="button"
                key={opt.v}
                onClick={() =>
                  onChange({ evidence: opt.v as Evidence, na: false })
                }
                className={`likert-option ${selected ? "selected" : ""}`}
              >
                <span className="num">{opt.v}</span>
                <span className="label">{opt.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onChange({ na: !na, evidence: undefined })}
          className={`mt-2 text-xs font-mono underline-offset-2 ${
            na ? "text-accent underline" : "text-ink-soft hover:text-ink"
          }`}
        >
          {na
            ? "✓ 측정/기록 없음 (선택 해제하기)"
            : "측정/기록 없음으로 표시"}
        </button>
      </div>

      <p className="mt-4 dotted-rule pt-3 label-mono">
        근거: 회사 컨텍스트 기반 자동 추가 · 거부 시 점수 계산에서 제외
      </p>
    </article>
  );
}

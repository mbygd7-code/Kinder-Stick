"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CADENCE_LABEL,
  getAiLeverage,
  getFunnelStage,
  type Cadence,
  type Task,
  type Tier,
} from "@/lib/worklist/catalog";

interface PlaybookKPI {
  name: string;
  threshold: string;
  method: string;
}
interface PlaybookStep {
  title: string;
  detail: string;
  owner?: string;
  estimated_hours?: number;
}
interface PlaybookData {
  summary: string;
  output: string;
  steps: PlaybookStep[];
  kpis: PlaybookKPI[];
  sample: string;
  pitfalls: string[];
  references: string[];
  model: string;
  generated_at: string;
}

interface Props {
  description?: string;
  why: string;
  hint?: string;
  ai_leverage?: string;
  escalation_hint?: string;
  cadence: Cadence;
  tier: Tier;
  domain?: string;
  task?: Task;
}

const CACHE_VERSION = "v4"; // v4: 본문 마크다운 sanitize

function cacheKey(taskId: string): string {
  return `worklist:playbook:${CACHE_VERSION}:${taskId}`;
}

function loadPlaybook(taskId: string): PlaybookData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(taskId));
    if (!raw) return null;
    return JSON.parse(raw) as PlaybookData;
  } catch {
    return null;
  }
}

function savePlaybook(taskId: string, p: PlaybookData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(taskId), JSON.stringify(p));
  } catch {
    /* quota */
  }
}

function removePlaybook(taskId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(cacheKey(taskId));
}

export function TaskDescriptionPopover({
  description,
  why,
  hint,
  ai_leverage,
  escalation_hint,
  cadence,
  tier,
  domain,
  task,
}: Props) {
  const [open, setOpen] = useState(false);
  const [playbook, setPlaybook] = useState<PlaybookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !task) return;
    const cached = loadPlaybook(task.id);
    if (cached) setPlaybook(cached);
  }, [open, task]);

  const generate = useCallback(async () => {
    if (!task) return;
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/worklist/playbook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: task.id,
          title: task.title,
          why: task.why,
          team: task.team,
          phase: task.phase,
          funnel_stage: getFunnelStage(task),
          cadence: task.cadence,
          tier: task.tier,
          domain: task.domain,
          hint: task.hint,
          ai_leverage: getAiLeverage(task),
        }),
      });
      const data = (await r.json()) as
        | PlaybookData
        | { error: string; detail?: string };
      if (!r.ok || "error" in data) {
        const err = (data as { error?: string }).error ?? "unknown";
        const detail = (data as { detail?: string }).detail;
        setError(`자료 생성 실패: ${err}${detail ? ` — ${detail}` : ""}`);
        return;
      }
      setPlaybook(data);
      savePlaybook(task.id, data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, [task]);

  const regenerate = useCallback(async () => {
    if (!task) return;
    removePlaybook(task.id);
    setPlaybook(null);
    await generate();
  }, [task, generate]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function escHandler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open]);

  const tierLabel =
    tier === "must" ? "필수" : tier === "conditional" ? "조건부" : "정기";

  return (
    <div ref={containerRef} className="shrink-0 relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-6 h-6 flex items-center justify-center rounded-full border transition-colors text-xs font-mono ${
          open
            ? "border-ink bg-ink text-paper"
            : "border-ink-soft/40 text-ink-soft hover:border-ink hover:bg-paper-deep hover:text-ink"
        }`}
        title="자세한 설명 + 실무 자료"
        aria-label="자세한 설명 보기"
        aria-expanded={open}
      >
        ?
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="false"
          className="fixed sm:absolute sm:right-0 sm:top-7 inset-x-2 sm:inset-x-auto top-16 sm:top-7 z-30 w-auto sm:w-[44rem] lg:w-[52rem] max-h-[80vh] sm:max-h-[80vh] overflow-y-auto bg-paper border-2 border-ink shadow-2xl"
        >
          {/* ── Header ─────────────────────────────────────────── */}
          <header className="sticky top-0 bg-paper border-b-2 border-ink px-6 py-4 flex items-center justify-between gap-3 flex-wrap z-10">
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="t-label-ink">실무 자료</p>
              <p className="t-label">
                {CADENCE_LABEL[cadence]} · {tierLabel}
                {domain ? ` · ${domain}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="t-label hover:text-ink"
              aria-label="닫기"
            >
              CLOSE
            </button>
          </header>

          <div className="px-6 py-5">
            {/* ── 1. Why (static) ──────────────────────────────── */}
            {description ? (
              <Description text={description} />
            ) : (
              <FallbackContent
                why={why}
                hint={hint}
                ai_leverage={ai_leverage}
                escalation_hint={escalation_hint}
              />
            )}

            {/* ── 2. AI Playbook ───────────────────────────────── */}
            {task ? (
              <div className="mt-10 pt-6 border-t-2 border-ink">
                <div className="flex items-baseline justify-between gap-3 mb-6 flex-wrap">
                  <div>
                    <p className="t-label-accent">AI 플레이북</p>
                    <h3 className="t-display-3 text-ink mt-1">
                      실행에 필요한 모든 자료
                    </h3>
                    <p className="t-meta mt-1.5">
                      샘플 템플릿 · 단계별 진행 방법 · 검증 KPI · 자주 하는 실수
                    </p>
                  </div>
                  {playbook ? (
                    <button
                      type="button"
                      onClick={regenerate}
                      disabled={loading}
                      className="t-label px-3 py-1.5 border border-ink-soft/50 hover:border-ink hover:bg-paper-deep disabled:opacity-50"
                      title="자료를 다시 생성합니다"
                    >
                      다시 생성
                    </button>
                  ) : null}
                </div>

                {loading ? (
                  <LoadingState />
                ) : error ? (
                  <ErrorState error={error} onRetry={generate} />
                ) : playbook ? (
                  <PlaybookView data={playbook} />
                ) : (
                  <EmptyState onGenerate={generate} />
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// State subcomponents
// ============================================================

function LoadingState() {
  return (
    <div className="py-8 px-6 border-2 border-dashed border-ink/40 bg-paper-deep">
      {/* Spinner + label */}
      <div className="flex flex-col items-center gap-3">
        <Spinner />
        <p className="t-label-ink flex items-center gap-1.5">
          <span>AI 분석 중</span>
          <span className="flex items-end gap-0.5 mb-0.5" aria-hidden="true">
            <span className="w-1 h-1 rounded-full bg-ink animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 rounded-full bg-ink animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 rounded-full bg-ink animate-bounce" />
          </span>
        </p>
        <p className="text-center t-body-sm text-ink-soft">
          이 업무에 대한 실무 자료를 작성하고 있습니다.
          <br />
          <span className="t-meta">평균 소요 시간 5–10초</span>
        </p>
      </div>

      {/* Indeterminate progress bar — moving stripe */}
      <div className="mt-5 mx-auto max-w-md h-1 bg-ink-soft/15 overflow-hidden relative">
        <div className="absolute inset-y-0 w-1/3 bg-ink animate-[loader-slide_1.6s_ease-in-out_infinite]" />
      </div>

      {/* Skeleton sections — what will fill in */}
      <div className="mt-7 space-y-5 max-w-lg mx-auto">
        <SkeletonBlock label="A — 결과물" lines={2} />
        <SkeletonBlock label="B — 진행 단계" lines={4} />
        <SkeletonBlock label="C — 검증 KPI" lines={3} />
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="w-12 h-12 animate-spin text-ink"
      viewBox="0 0 50 50"
      aria-hidden="true"
    >
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth="3"
      />
      <path
        d="M25 5 A20 20 0 0 1 45 25"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SkeletonBlock({
  label,
  lines,
}: {
  label: string;
  lines: number;
}) {
  return (
    <div>
      <p className="t-label mb-2 pb-1 border-b border-ink-soft/20">{label}</p>
      <div className="space-y-1.5">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3.5 bg-ink-soft/15 animate-pulse"
            style={{
              width: `${100 - i * 8}%`,
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="border-l-4 border-accent bg-soft-red/20 px-4 py-3">
      <p className="t-label-accent mb-1.5">오류</p>
      <p className="t-body-sm mb-3">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="t-label-ink px-3 py-1.5 bg-ink !text-paper border-2 border-ink hover:bg-paper hover:!text-ink"
      >
        다시 시도
      </button>
    </div>
  );
}

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="border-2 border-dashed border-ink-soft/40 px-6 py-8 text-center">
      <p className="t-body mb-5">
        이 업무에 대한{" "}
        <strong className="font-semibold text-ink">
          샘플 템플릿, 단계별 진행 방법, 검증 KPI, 자주 하는 실수, 참고 자료
        </strong>
        를 AI가 생성합니다.
        <br />
        <span className="t-body-muted">
          한 번 만들면 다음 방문 시 즉시 표시됩니다.
        </span>
      </p>
      <button
        type="button"
        onClick={onGenerate}
        className="px-6 py-3 t-label-ink !text-paper bg-ink border-2 border-ink hover:bg-accent hover:border-accent transition-colors"
      >
        실무 자료 생성하기
      </button>
    </div>
  );
}

// ============================================================
// Playbook view — editorial design
// ============================================================

function PlaybookView({ data }: { data: PlaybookData }) {
  const [copiedSample, setCopiedSample] = useState(false);

  async function copySample() {
    try {
      await navigator.clipboard.writeText(data.sample);
      setCopiedSample(true);
      setTimeout(() => setCopiedSample(false), 1800);
    } catch {
      /* permission denied */
    }
  }

  return (
    <div className="space-y-10">
      {/* ── Summary — hero block ──────────────────────────── */}
      {data.summary ? (
        <div className="border-l-[6px] border-ink pl-5 py-1">
          <p className="t-label mb-2">요약</p>
          <p className="t-lede font-display">{data.summary}</p>
        </div>
      ) : null}

      {/* ── Output ─────────────────────────────────────────── */}
      {data.output ? (
        <Section label="결과물" index="A">
          <p className="t-body">{data.output}</p>
        </Section>
      ) : null}

      {/* ── Steps ──────────────────────────────────────────── */}
      {data.steps.length > 0 ? (
        <Section label={`진행 단계 ${data.steps.length}`} index="B">
          <ol className="space-y-6 mt-3">
            {data.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[3rem_1fr] gap-4">
                <div className="text-right">
                  <p className="t-display-1 text-ink leading-none">
                    {(i + 1).toString().padStart(2, "0")}
                  </p>
                </div>
                <div className="border-l-2 border-ink-soft/30 pl-5 pb-1">
                  <h5 className="t-display-4 text-ink">{s.title}</h5>
                  {(s.owner || s.estimated_hours) ? (
                    <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                      {s.owner ? (
                        <span className="t-label">
                          담당{" "}
                          <span className="text-ink font-semibold">
                            {s.owner}
                          </span>
                        </span>
                      ) : null}
                      {s.owner && s.estimated_hours ? (
                        <span className="t-label text-ink-soft/40">·</span>
                      ) : null}
                      {s.estimated_hours ? (
                        <span className="t-label">
                          예상{" "}
                          <span className="text-ink font-semibold">
                            {s.estimated_hours}h
                          </span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="mt-2.5 t-body-sm">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {/* ── KPIs ───────────────────────────────────────────── */}
      {data.kpis.length > 0 ? (
        <Section label={`검증 KPI ${data.kpis.length}`} index="C">
          <div className="border-2 border-ink mt-3">
            {data.kpis.map((k, i) => (
              <div
                key={i}
                className={`grid grid-cols-[7.5rem_1fr] gap-x-5 px-5 py-4 ${
                  i < data.kpis.length - 1 ? "border-b border-ink-soft/40" : ""
                }`}
              >
                <div>
                  <p className="t-label mb-1">지표</p>
                  <p className="t-display-4 text-ink">{k.name}</p>
                </div>
                <div>
                  <p className="t-label mb-1">목표</p>
                  <p className="t-display-3 text-accent">{k.threshold}</p>
                  {k.method ? (
                    <>
                      <p className="t-label mt-3 mb-1">측정</p>
                      <p className="t-body-sm text-ink/85">{k.method}</p>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── Sample ─────────────────────────────────────────── */}
      {data.sample ? (
        <Section label="샘플 템플릿" index="D">
          <div className="relative mt-3">
            <button
              type="button"
              onClick={copySample}
              className="absolute top-2 right-2 z-10 px-3 py-1.5 t-label-ink bg-paper border-2 border-ink hover:bg-ink hover:!text-paper transition-colors"
              title="템플릿을 클립보드에 복사"
            >
              {copiedSample ? "복사됨" : "복사"}
            </button>
            <pre className="whitespace-pre-wrap text-[13px] font-mono bg-paper-deep border-2 border-ink-soft/40 px-5 py-4 pr-24 leading-[1.75] max-h-[28rem] overflow-auto text-ink">
              {data.sample}
            </pre>
          </div>
        </Section>
      ) : null}

      {/* ── Pitfalls ───────────────────────────────────────── */}
      {data.pitfalls.length > 0 ? (
        <Section label={`자주 하는 실수 ${data.pitfalls.length}`} index="E">
          <ul className="mt-3 space-y-2.5">
            {data.pitfalls.map((p, i) => (
              <li
                key={i}
                className="grid grid-cols-[3rem_1fr] gap-3 border-l-2 border-amber bg-soft-amber/20 pl-4 pr-3 py-2.5"
              >
                <span className="t-label-ink text-amber">주의</span>
                <span className="t-body-sm">{p}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ── References ─────────────────────────────────────── */}
      {data.references.length > 0 ? (
        <Section label="참고 자료" index="F">
          <ul className="mt-3 space-y-2">
            {data.references.map((r, i) => (
              <li
                key={i}
                className="grid grid-cols-[2.5rem_1fr] gap-3"
              >
                <span className="t-label t-num">
                  {(i + 1).toString().padStart(2, "0")}
                </span>
                <span className="t-meta">{r}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ── Footer meta ────────────────────────────────────── */}
      <p className="t-label pt-3 border-t border-ink-soft/30">
        AI 생성 · {new Date(data.generated_at).toLocaleString("ko-KR")} ·
        브라우저 캐시
      </p>
    </div>
  );
}

function Section({
  label,
  index,
  children,
}: {
  label: string;
  index: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4 pb-2 border-b-2 border-ink">
        <span className="t-display-2 text-accent leading-none">{index}</span>
        <h4 className="t-label-ink">{label}</h4>
      </div>
      {children}
    </section>
  );
}

// ============================================================
// Static description (legacy) — clean rendering, no emoji icons
// ============================================================

function Description({ text }: { text: string }) {
  const sections = splitSections(text);
  return (
    <div className="space-y-5">
      {sections.map((s, i) =>
        s.heading ? (
          <div key={i}>
            <p className="t-label mb-2">{s.heading.label}</p>
            <p className="t-body whitespace-pre-line">{s.body}</p>
          </div>
        ) : (
          <p key={i} className="t-body whitespace-pre-line">
            {s.body}
          </p>
        ),
      )}
    </div>
  );
}

interface Section {
  heading?: { icon: string; label: string };
  body: string;
}

// Legacy section markers in catalog descriptions — kept for backward compat,
// but rendered as clean uppercase mono labels (without the marker character).
const HEADING_ICONS = ["ⓘ", "⚙", "✔"];

function splitSections(text: string): Section[] {
  const lines = text.split("\n");
  const out: Section[] = [];
  let cur: Section = { body: "" };
  let bodyLines: string[] = [];

  function flush() {
    cur.body = bodyLines.join("\n").trim();
    if (cur.body || cur.heading) out.push(cur);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const startsWithIcon = HEADING_ICONS.find((i) => trimmed.startsWith(i));
    if (startsWithIcon) {
      flush();
      cur = {
        heading: {
          icon: startsWithIcon,
          label: trimmed.slice(startsWithIcon.length).trim(),
        },
        body: "",
      };
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }
  flush();
  return out;
}

function FallbackContent({
  why,
  hint,
  ai_leverage,
  escalation_hint,
}: {
  why: string;
  hint?: string;
  ai_leverage?: string;
  escalation_hint?: string;
}) {
  return (
    <div className="space-y-5">
      <p className="t-body">{why}</p>
      {hint ? <Block label="실행 힌트" body={hint} /> : null}
      {ai_leverage ? (
        <Block label="AI로 가속하는 법" body={ai_leverage} />
      ) : null}
      {escalation_hint ? (
        <Block label="회사 목표와의 관계" body={escalation_hint} />
      ) : null}
    </div>
  );
}

function Block({ label, body }: { label: string; body: ReactNode }) {
  return (
    <div>
      <p className="t-label mb-1.5">{label}</p>
      <p className="t-body">{body}</p>
    </div>
  );
}

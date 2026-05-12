"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  TASKS,
  TEAM_LABEL,
  PHASE_LABEL,
  FUNNEL_LABEL,
  CADENCE_LABEL,
  TIER_LABEL,
  type DerivedTask,
  type TaskOverride,
} from "@/lib/worklist/catalog";
import {
  parseFile,
  FILE_ACCEPT,
  KIND_LABEL,
  type FileParseResult,
} from "@/lib/worklist/file-parsers";
import {
  appendIngestResult,
  loadDerived,
  loadOverrides,
  removeDerived,
  removeOverride,
  subscribeWorklistChange,
} from "@/lib/worklist/storage";

interface Props {
  workspace: string;
}

type Mode = "text" | "file";
type Source = "ga4" | "admin" | "mixpanel" | "channeltalk" | "nps" | "revenue" | "other";
type Period = "weekly" | "monthly" | "quarterly";

interface DeriveResult {
  overrides: TaskOverride[];
  derived: DerivedTask[];
  summary: string;
  model: string;
  raw_preview?: string;
}

const SOURCE_LABELS: Record<Source, string> = {
  ga4: "GA4 (트래픽)",
  admin: "Admin DB (회원·매출)",
  mixpanel: "Mixpanel / Amplitude",
  channeltalk: "ChannelTalk (CS)",
  nps: "NPS 설문",
  revenue: "매출 대시보드",
  other: "기타",
};

const PERIOD_LABELS: Record<Period, string> = {
  weekly: "주간 (7일)",
  monthly: "월간 (30일)",
  quarterly: "분기 (90일)",
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TEXT_LEN = 50_000;

const PLACEHOLDER =
  "예: 킨더보드 주간 운영 리포트 (2026-05-11)\n\n" +
  "[활성 사용자]\n" +
  "- DAU 355명 (+43)\n" +
  "- WAU 2,290명 (-807, -26.1%)\n" +
  "- MAU 14,918명 (-65.8%)\n\n" +
  "[획득]\n" +
  "- 신규 가입 -39.4% (ADMIN DB)\n" +
  "- 신규 사용자 -1,124 (GA4)\n" +
  "- 세션수 5,966 (-23.7%)\n\n" +
  "[채널]\n" +
  "- 구글 27.6%, 네이버 18%\n" +
  "- 인포크링크 -43.2%, 빙 -41.4%\n" +
  "- 직접 유입 +30.8%, 슬래시페이지 +90%\n\n" +
  "[페이지 사용]\n" +
  "- 킨더보드/메인/로그인 -16~-31%\n" +
  "- 놀이계획작성/우리반/기록보기 -17~-28%\n" +
  "- 아이등록 +3.2%, 아이상세 +5.5%, 관찰기록 +6.6%\n" +
  "- AI비서 6,425회 (페이지 조회 1위)\n";

export function DataIngestPanel({ workspace }: Props) {
  const [mode, setMode] = useState<Mode>("text");
  const [source, setSource] = useState<Source>("ga4");
  const [period, setPeriod] = useState<Period>("weekly");
  const [text, setText] = useState("");
  const [fileMeta, setFileMeta] = useState<FileParseResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeriveResult | null>(null);
  const [selectedOverrides, setSelectedOverrides] = useState<Set<string>>(
    new Set(),
  );
  const [selectedDerived, setSelectedDerived] = useState<Set<string>>(
    new Set(),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // applied state (from localStorage) — for the "현재 적용된 변경" summary
  const [applied, setApplied] = useState<{
    derived: DerivedTask[];
    overrides: TaskOverride[];
  }>({ derived: [], overrides: [] });

  useEffect(() => {
    const refresh = () => {
      setApplied({
        derived: loadDerived(workspace),
        overrides: loadOverrides(workspace),
      });
    };
    refresh();
    return subscribeWorklistChange(refresh);
  }, [workspace]);

  // Auto-select all high-confidence rows when a new result arrives
  useEffect(() => {
    if (!result) {
      setSelectedOverrides(new Set());
      setSelectedDerived(new Set());
      return;
    }
    setSelectedOverrides(
      new Set(
        result.overrides
          .filter((o) => o.confidence >= 0.6)
          .map((o) => o.task_id),
      ),
    );
    setSelectedDerived(
      new Set(
        result.derived.filter((d) => d.confidence >= 0.6).map((d) => d.id),
      ),
    );
  }, [result]);

  /** 파일을 파싱하고, 성공 시 자동으로 분석까지 실행. */
  async function handleFile(file: File | null) {
    setFileError(null);
    setFileMeta(null);
    setResult(null);
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setFileError(
        `파일이 너무 큽니다: ${(file.size / 1024 / 1024).toFixed(1)}MB (최대 5MB).`,
      );
      return;
    }
    setParsing(true);
    try {
      const meta = await parseFile(file);
      setFileMeta(meta);
      setText(meta.text);
      setParsing(false);
      // 파싱 끝나면 바로 AI 분석 시작 — 사용자가 분석 버튼을 다시 누를 필요 없음
      await runAnalyze(meta.text);
    } catch (e) {
      setParsing(false);
      setFileError(e instanceof Error ? e.message : "파일 파싱 실패");
    }
  }

  /** "파일 첨부" 탭 버튼 클릭 시 — 모드 전환 + 파일 피커 즉시 열기. */
  function handleOpenFilePicker() {
    setMode("file");
    setError(null);
    setFileError(null);
    // 같은 파일을 다시 선택해도 onChange가 트리거되도록 value 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  /** 분석 실행 — 텍스트 인자 옵셔널 (자동 분석에서 state 갱신 전에 호출되는 경우 대비). */
  async function runAnalyze(textToAnalyze?: string) {
    const t = (textToAnalyze ?? text).trim();
    setError(null);
    setResult(null);
    if (!t) {
      setError("텍스트 또는 파일을 입력해주세요.");
      return;
    }
    if (t.length > MAX_TEXT_LEN) {
      setError(`텍스트가 너무 깁니다 (최대 ${MAX_TEXT_LEN.toLocaleString()}자).`);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/worklist/derive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, source, period, workspace }),
      });
      const data = (await r.json()) as
        | DeriveResult
        | { error: string; detail?: string };
      if (!r.ok || "error" in data) {
        const err = (data as { error?: string }).error ?? "unknown_error";
        const detail = (data as { detail?: string }).detail;
        setError(`분석 실패: ${err}${detail ? ` — ${detail}` : ""}`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "네트워크 오류");
    } finally {
      setLoading(false);
    }
  }

  /** "분석" 버튼 클릭 핸들러 — runAnalyze 의 wrapper. */
  async function handleAnalyze() {
    await runAnalyze();
  }

  function handleApply() {
    if (!result) return;
    const derivedToApply = result.derived.filter((d) =>
      selectedDerived.has(d.id),
    );
    const overridesToApply = result.overrides.filter((o) =>
      selectedOverrides.has(o.task_id),
    );
    if (derivedToApply.length === 0 && overridesToApply.length === 0) {
      setError("반영할 항목을 1개 이상 선택해주세요.");
      return;
    }
    appendIngestResult(workspace, derivedToApply, overridesToApply);
    setError(null);
    // 결과 화면은 유지하되 적용 표시를 보이게.
  }

  const taskById = new Map(TASKS.map((t) => [t.id, t] as const));

  return (
    <section className="border-2 border-ink bg-paper p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <div>
          <p className="kicker mb-1">
            외부 데이터로 워크리스트 변형 — Looker · GA4 · NPS · 매출 · CS
          </p>
          <h2 className="font-display text-xl sm:text-2xl leading-tight">
            분석 데이터가 들어오면, 업무가 변합니다
          </h2>
          <p className="mt-1 label-mono">
            텍스트 요약·CSV·XLSX 를 붙여넣으면 AI가 (a) 기존 업무 격상 (b) 신규
            업무 추가를 제안합니다. 모두 localStorage에 저장 — 워크스페이스
            범위로만 적용됩니다.
          </p>
        </div>
        {applied.derived.length + applied.overrides.length > 0 ? (
          <div className="border-2 border-ink bg-ink text-paper px-3 py-2 text-sm">
            <p className="font-mono uppercase tracking-widest mb-0.5 text-[10px] text-paper/70">
              현재 적용됨
            </p>
            <p className="font-display tabular-nums">
              신규 <span className="font-bold">{applied.derived.length}</span>{" "}
              · 격상{" "}
              <span className="font-bold">{applied.overrides.length}</span>
            </p>
          </div>
        ) : null}
      </div>

      {/* Hidden file input — 항상 마운트되어 있어서 어디서든 click()으로 열림 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          void handleFile(f);
        }}
      />

      {/* Mode tabs — segmented buttons */}
      <div className="mb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft mb-2">
          입력 방식
        </p>
        <div className="flex flex-wrap gap-2">
          {/* 텍스트 버튼 */}
          {(() => {
            const isActive = mode === "text";
            return (
              <button
                type="button"
                onClick={() => setMode("text")}
                aria-pressed={isActive}
                disabled={parsing || loading}
                className={`inline-flex items-center gap-3 px-4 py-2.5 border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  isActive
                    ? "bg-ink text-paper border-ink"
                    : "bg-paper text-ink border-ink hover:bg-paper-deep"
                }`}
              >
                <span
                  className={`font-mono text-[10px] uppercase tracking-widest ${
                    isActive ? "text-paper/60" : "text-ink-soft"
                  }`}
                  aria-hidden="true"
                >
                  01
                </span>
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-display text-sm font-semibold">
                    텍스트 붙여넣기
                  </span>
                  <span
                    className={`text-[10px] font-mono tracking-wide ${
                      isActive ? "text-paper/70" : "text-ink-soft"
                    }`}
                  >
                    분석 요약·표·숫자를 그대로 복붙
                  </span>
                </span>
              </button>
            );
          })()}

          {/* 파일 버튼 — 클릭 시 파일 피커 즉시 열림 */}
          {(() => {
            const isActive = mode === "file";
            const busy = parsing || loading;
            return (
              <button
                type="button"
                onClick={handleOpenFilePicker}
                aria-pressed={isActive}
                disabled={busy}
                className={`inline-flex items-center gap-3 px-4 py-2.5 border-2 transition-all disabled:opacity-60 disabled:cursor-wait ${
                  isActive
                    ? "bg-ink text-paper border-ink"
                    : "bg-paper text-ink border-ink hover:bg-paper-deep"
                }`}
              >
                <span
                  className={`font-mono text-[10px] uppercase tracking-widest ${
                    isActive ? "text-paper/60" : "text-ink-soft"
                  }`}
                  aria-hidden="true"
                >
                  02
                </span>
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-display text-sm font-semibold">
                    {parsing
                      ? "파일 파싱 중…"
                      : loading && isActive
                        ? "AI 분석 중…"
                        : "파일 첨부"}
                  </span>
                  <span
                    className={`text-[10px] font-mono tracking-wide ${
                      isActive ? "text-paper/70" : "text-ink-soft"
                    }`}
                  >
                    CSV · XLSX · Word · TXT · MD (최대 5MB)
                  </span>
                </span>
              </button>
            );
          })()}

          {/* URL 입력 (준비 중) */}
          <button
            type="button"
            disabled
            title="Phase 2 예정 — Looker Studio 공유 링크 직접 입력"
            className="inline-flex items-center gap-3 px-4 py-2.5 border-2 border-dashed border-ink-soft/40 bg-paper-deep text-ink-soft/60 cursor-not-allowed"
          >
            <span
              className="font-mono text-[10px] uppercase tracking-widest text-ink-soft/40"
              aria-hidden="true"
            >
              03
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="font-display text-sm font-semibold">
                URL 입력
              </span>
              <span className="text-[10px] font-mono tracking-wide">
                준비 중 · Phase 2
              </span>
            </span>
          </button>
        </div>
      </div>

      {/* Source + Period selectors */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <label className="text-sm">
          <span className="label-mono block mb-1">데이터 소스</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
            className="w-full border-2 border-ink-soft/50 bg-paper px-2 py-1.5 font-display text-sm"
          >
            {(Object.keys(SOURCE_LABELS) as Source[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label-mono block mb-1">측정 기간</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="w-full border-2 border-ink-soft/50 bg-paper px-2 py-1.5 font-display text-sm"
          >
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Input area */}
      {mode === "text" ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={10}
          className="w-full border-2 border-ink-soft/40 bg-paper-deep p-3 text-sm font-mono leading-relaxed resize-y"
        />
      ) : (
        <div
          className={`border-2 border-dashed p-5 transition-colors ${
            parsing || loading
              ? "border-ink bg-soft-amber/30"
              : fileMeta
                ? "border-ink bg-paper-deep"
                : "border-ink-soft/40 bg-paper-deep"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0] ?? null;
            if (f) void handleFile(f);
          }}
        >
          {parsing ? (
            <IngestLoadingState
              labelMono="파일 파싱 중"
              title="잠시만 기다려주세요…"
              subtitle="대용량 .docx / .xlsx는 1–2초 걸릴 수 있습니다."
              accent={false}
              skeleton={false}
            />
          ) : loading ? (
            <IngestLoadingState
              labelMono="AI 분석 중"
              title="마케팅 퍼널 7단계 진단을 작성하고 있습니다."
              subtitle="신호 추출 · 시사점 · 실무 가이드 작성 (약 10–20초)"
              accent={true}
              skeleton={true}
            />
          ) : fileMeta ? (
            <div className="text-sm">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-ink-soft mb-0.5">
                    업로드 완료
                  </p>
                  <p className="font-display text-[15px] font-semibold">
                    {fileMeta.filename}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-ink-soft mt-1">
                    {KIND_LABEL[fileMeta.kind]} · {fileMeta.rows_used}개 항목
                    {fileMeta.truncated ? " · 잘림" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenFilePicker}
                  className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest border border-ink-soft/50 hover:border-ink hover:bg-paper"
                >
                  다른 파일
                </button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-ink-soft hover:text-ink">
                  변환된 텍스트 미리보기 ({fileMeta.text.length.toLocaleString()}자)
                </summary>
                <pre className="mt-2 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-auto bg-paper p-2 border border-ink-soft/30">
                  {fileMeta.text.slice(0, 4000)}
                  {fileMeta.text.length > 4000 ? "\n…" : ""}
                </pre>
              </details>
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-soft mb-2">
                업로드
              </p>
              <p className="font-display text-base">
                여기로 파일을 끌어놓거나
              </p>
              <button
                type="button"
                onClick={handleOpenFilePicker}
                className="inline-block px-5 py-2 mt-2.5 font-display text-sm font-semibold bg-ink text-paper border-2 border-ink hover:bg-paper hover:text-ink transition-colors"
              >
                파일 선택
              </button>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-ink-soft">
                CSV · XLSX · WORD · TXT · MD · 최대 5MB · 업로드 즉시 자동 분석
              </p>
            </div>
          )}
          {fileError ? (
            <p className="mt-3 text-sm text-accent bg-soft-red/20 border-l-4 border-accent px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-widest mr-2">
                오류
              </span>
              {fileError}
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={loading || text.trim().length === 0}
          className="px-4 py-2 font-display text-sm bg-ink text-paper border-2 border-ink hover:bg-paper hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "AI 분석 중…" : "분석"}
        </button>
        {text.length > 0 ? (
          <span className="label-mono">
            {text.length.toLocaleString()} / {MAX_TEXT_LEN.toLocaleString()} 자
          </span>
        ) : null}
        {error ? <span className="text-sm text-accent">{error}</span> : null}
      </div>

      {/* Result preview */}
      {result ? (
        <div className="mt-6 border-t-2 border-ink pt-5 space-y-5">
          <div>
            <p className="kicker mb-2">AI 분석 결과 — 마케팅 퍼널 진단</p>
            <FunnelSummary text={result.summary} />
            {result.raw_preview ? (
              <p className="mt-2 text-xs text-ink-soft font-mono break-all">
                <span className="font-mono text-[10px] uppercase tracking-widest mr-1">
                  주의
                </span>
                파싱 실패 미리보기: {result.raw_preview}
              </p>
            ) : null}
          </div>

          {/* Overrides */}
          {result.overrides.length > 0 ? (
            <div>
              <h3 className="font-display text-lg mb-2 flex items-baseline gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest bg-accent text-paper px-1.5 py-0.5">
                  BOOST
                </span>
                <span>격상될 기존 업무</span>
                <span className="label-mono">({result.overrides.length})</span>
              </h3>
              <ul className="space-y-2">
                {result.overrides.map((o) => {
                  const base = taskById.get(o.task_id);
                  if (!base) return null;
                  const checked = selectedOverrides.has(o.task_id);
                  const cadenceChanged =
                    o.cadence_override && o.cadence_override !== base.cadence;
                  const tierChanged =
                    o.tier_boost && o.tier_boost !== base.tier;
                  return (
                    <li
                      key={o.task_id}
                      className={`border-2 ${
                        checked ? "border-ink" : "border-ink-soft/40"
                      } bg-paper p-3 text-sm`}
                    >
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selectedOverrides);
                            if (e.target.checked) next.add(o.task_id);
                            else next.delete(o.task_id);
                            setSelectedOverrides(next);
                          }}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-display font-medium">
                            {base.title}
                          </p>
                          <p className="label-mono mt-0.5">
                            {TEAM_LABEL[base.team]} · {PHASE_LABEL[base.phase]}
                          </p>
                          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                            {cadenceChanged ? (
                              <span className="text-xs">
                                <span className="label-mono">cadence:</span>{" "}
                                <span className="line-through text-ink-soft">
                                  {CADENCE_LABEL[base.cadence]}
                                </span>
                                {" → "}
                                <span className="font-medium text-accent">
                                  {CADENCE_LABEL[o.cadence_override!]}
                                </span>
                              </span>
                            ) : null}
                            {tierChanged ? (
                              <span className="text-xs">
                                <span className="label-mono">tier:</span>{" "}
                                <span className="line-through text-ink-soft">
                                  {TIER_LABEL[base.tier]}
                                </span>
                                {" → "}
                                <span className="font-medium text-accent">
                                  {TIER_LABEL[o.tier_boost!]}
                                </span>
                              </span>
                            ) : null}
                          </div>
                          {o.urgency_note ? (
                            <p className="mt-1.5 text-xs leading-snug">
                              <span className="font-medium">이유:</span>{" "}
                              {o.urgency_note}
                            </p>
                          ) : null}
                          <p className="mt-1 label-mono">
                            신뢰도 {(o.confidence * 100).toFixed(0)}%
                            {o.confidence < 0.6 ? (
                              <span className="ml-2 px-1 bg-soft-amber/40 text-ink border border-amber/40 font-mono text-[10px] uppercase tracking-widest">
                                낮음
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {/* Derived */}
          {result.derived.length > 0 ? (
            <div>
              <h3 className="font-display text-lg mb-2 flex items-baseline gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest bg-ink text-paper px-1.5 py-0.5">
                  NEW
                </span>
                <span>신규 추가될 업무</span>
                <span className="label-mono">({result.derived.length})</span>
              </h3>
              <ul className="space-y-2">
                {result.derived.map((d) => {
                  const checked = selectedDerived.has(d.id);
                  return (
                    <li
                      key={d.id}
                      className={`border-2 ${
                        checked ? "border-ink" : "border-ink-soft/40"
                      } bg-paper p-3 text-sm`}
                    >
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selectedDerived);
                            if (e.target.checked) next.add(d.id);
                            else next.delete(d.id);
                            setSelectedDerived(next);
                          }}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-display font-medium">{d.title}</p>
                          <p className="label-mono mt-0.5">
                            {TEAM_LABEL[d.team]} · {PHASE_LABEL[d.phase]} ·{" "}
                            {FUNNEL_LABEL[d.funnel_stage ?? "internal"]} ·{" "}
                            {CADENCE_LABEL[d.cadence]} · {TIER_LABEL[d.tier]}
                          </p>
                          <p className="mt-1.5 text-xs leading-snug">
                            <span className="font-medium">왜:</span> {d.why}
                          </p>
                          {d.source_insight ? (
                            <p className="mt-1 text-xs italic text-ink-soft leading-snug">
                              출처: {d.source_insight}
                            </p>
                          ) : null}
                          <p className="mt-1 label-mono">
                            신뢰도 {(d.confidence * 100).toFixed(0)}%
                            {d.confidence < 0.6 ? (
                              <span className="ml-2 px-1 bg-soft-amber/40 text-ink border border-amber/40 font-mono text-[10px] uppercase tracking-widest">
                                낮음
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {result.overrides.length === 0 && result.derived.length === 0 ? (
            <p className="label-mono">
              AI가 새 변경을 도출하지 못했습니다. 데이터를 더 구체적으로
              입력해보세요.
            </p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleApply}
                className="px-4 py-2 font-display text-sm bg-accent text-paper border-2 border-accent hover:bg-paper hover:text-accent transition-colors"
              >
                선택된 변경 워크리스트에 반영 ({selectedDerived.size}+
                {selectedOverrides.size})
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="px-3 py-2 label-mono border border-ink-soft/40 hover:border-ink"
              >
                닫기
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* Applied summary + 제거 */}
      {applied.derived.length + applied.overrides.length > 0 ? (
        <div className="mt-6 border-t border-ink-soft/30 pt-4">
          <details>
            <summary className="cursor-pointer kicker">
              현재 워크스페이스에 적용된 데이터 주도 변경 ({applied.derived.length}
              신규 / {applied.overrides.length} 격상)
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] mb-1.5"><span className="bg-ink text-paper px-1.5 py-0.5 mr-1">NEW</span> 신규</p>
                <ul className="space-y-1">
                  {applied.derived.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-baseline justify-between gap-2 border border-ink-soft/30 px-2 py-1"
                    >
                      <span className="truncate">{d.title}</span>
                      <button
                        type="button"
                        onClick={() => removeDerived(workspace, d.id)}
                        className="label-mono shrink-0 hover:text-accent"
                        title="이 신규 업무 제거"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  {applied.derived.length === 0 ? (
                    <li className="label-mono">(없음)</li>
                  ) : null}
                </ul>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] mb-1.5"><span className="bg-accent text-paper px-1.5 py-0.5 mr-1">BOOST</span> 격상</p>
                <ul className="space-y-1">
                  {applied.overrides.map((o) => {
                    const t = taskById.get(o.task_id);
                    return (
                      <li
                        key={o.task_id}
                        className="flex items-baseline justify-between gap-2 border border-ink-soft/30 px-2 py-1"
                      >
                        <span className="truncate">
                          {t?.title ?? o.task_id}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeOverride(workspace, o.task_id)}
                          className="label-mono shrink-0 hover:text-accent"
                          title="이 격상 해제"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                  {applied.overrides.length === 0 ? (
                    <li className="label-mono">(없음)</li>
                  ) : null}
                </ul>
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}

/**
 * FunnelSummary — AI가 반환한 마크다운-라이트 요약을 스타일된 블록으로 렌더링.
 * 지원: `## H2`, `### H3`, `- bullet`, `1. numbered`, `**bold**`, 빈 줄(분리)
 */
function FunnelSummary({ text }: { text: string }) {
  // 줄 단위로 분해해서 블록 구조 만들기
  const lines = text.split(/\r?\n/);
  const blocks: Array<
    | { kind: "h2"; text: string }
    | { kind: "h3"; text: string }
    | { kind: "ul"; items: string[] }
    | { kind: "ol"; items: string[] }
    | { kind: "p"; text: string }
    | { kind: "sep" }
  > = [];

  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const trimmed = ln.trim();
    if (trimmed === "" || trimmed === "```") {
      blocks.push({ kind: "sep" });
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ kind: "h2", text: trimmed.slice(3) });
      i++;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push({ kind: "h3", text: trimmed.slice(4) });
      i++;
      continue;
    }
    if (/^[-*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    blocks.push({ kind: "p", text: trimmed });
    i++;
  }

  return (
    <div className="border-l-4 border-accent bg-paper-deep px-4 py-3 space-y-2 text-sm leading-relaxed">
      {blocks.map((b, idx) => {
        if (b.kind === "sep") return <div key={idx} className="h-1" />;
        if (b.kind === "h2")
          return (
            <h3
              key={idx}
              className="font-display text-lg font-medium leading-tight mt-2 mb-1 pb-1 border-b border-ink-soft/30"
            >
              {renderInline(b.text)}
            </h3>
          );
        if (b.kind === "h3")
          return (
            <h4
              key={idx}
              className="font-display text-base font-medium leading-tight mt-3 text-ink"
            >
              {renderInline(b.text)}
            </h4>
          );
        if (b.kind === "ul")
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j} className="leading-relaxed">
                  {renderInline(it)}
                </li>
              ))}
            </ul>
          );
        if (b.kind === "ol")
          return (
            <ol key={idx} className="list-decimal pl-5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j} className="leading-relaxed">
                  {renderInline(it)}
                </li>
              ))}
            </ol>
          );
        return (
          <p key={idx} className="leading-relaxed">
            {renderInline(b.text)}
          </p>
        );
      })}
    </div>
  );
}

/** Render inline `**bold**` and `*italic*` markers. */
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Split on **bold** first, then on *italic* inside non-bold segments
  const boldRe = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(
        <span key={key++}>{splitItalic(text.slice(lastIdx, m.index), key)}</span>,
      );
    }
    parts.push(
      <strong key={key++} className="font-semibold text-ink">
        {m[1]}
      </strong>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(
      <span key={key++}>{splitItalic(text.slice(lastIdx), key)}</span>,
    );
  }
  return parts;
}

function splitItalic(text: string, baseKey: number): ReactNode[] {
  const out: ReactNode[] = [];
  const italicRe = /\*([^*]+)\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let k = baseKey * 100;
  while ((m = italicRe.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index));
    out.push(
      <em key={k++} className="italic">
        {m[1]}
      </em>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

// ============================================================
// IngestLoadingState — 파일 파싱 / AI 분석 공통 로딩 화면
// ============================================================

function IngestLoadingState({
  labelMono,
  title,
  subtitle,
  accent,
  skeleton,
}: {
  labelMono: string;
  title: string;
  subtitle?: string;
  accent: boolean;
  skeleton: boolean;
}) {
  const barColor = accent ? "bg-accent" : "bg-ink";
  const labelColor = accent ? "text-accent" : "text-ink-soft";
  return (
    <div className="py-6 px-4 space-y-5">
      {/* Spinner + label + bouncing dots */}
      <div className="flex flex-col items-center gap-3">
        <IngestSpinner accent={accent} />
        <p
          className={`font-mono text-[11px] uppercase tracking-[0.3em] ${labelColor} flex items-center gap-1.5 font-semibold`}
        >
          <span>{labelMono}</span>
          <span
            className="flex items-end gap-0.5 mb-0.5"
            aria-hidden="true"
          >
            <span
              className={`w-1 h-1 rounded-full ${barColor} animate-bounce [animation-delay:-0.3s]`}
            />
            <span
              className={`w-1 h-1 rounded-full ${barColor} animate-bounce [animation-delay:-0.15s]`}
            />
            <span
              className={`w-1 h-1 rounded-full ${barColor} animate-bounce`}
            />
          </span>
        </p>
        <p className="font-display text-base font-medium text-center">
          {title}
        </p>
        {subtitle ? (
          <p className="t-meta text-center">{subtitle}</p>
        ) : null}
      </div>

      {/* Indeterminate progress bar — moving stripe */}
      <div className="mx-auto max-w-md h-1 bg-ink-soft/15 overflow-hidden relative">
        <div
          className={`absolute inset-y-0 w-1/3 ${barColor} animate-[loader-slide_1.6s_ease-in-out_infinite]`}
        />
      </div>

      {/* Skeleton sections (analysis only) */}
      {skeleton ? (
        <div className="mt-2 max-w-lg mx-auto space-y-4">
          <IngestSkeletonBlock label="인지 (Awareness)" lines={2} />
          <IngestSkeletonBlock label="획득 (Acquisition)" lines={3} />
          <IngestSkeletonBlock label="활성화 (Activation)" lines={2} />
          <IngestSkeletonBlock label="종합 진단 + 우선순위" lines={3} />
        </div>
      ) : null}
    </div>
  );
}

function IngestSpinner({ accent }: { accent: boolean }) {
  const color = accent ? "text-accent" : "text-ink";
  return (
    <svg
      className={`w-10 h-10 animate-spin ${color}`}
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

function IngestSkeletonBlock({
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
            className="h-3 bg-ink-soft/15 animate-pulse"
            style={{
              width: `${100 - i * 10}%`,
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

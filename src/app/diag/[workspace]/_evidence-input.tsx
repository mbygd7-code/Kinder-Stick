"use client";

/**
 * EvidenceInputPanel — 진단 폼의 evidence 항목 옆에 붙는 확장 패널.
 *
 * 목표: belief × evidence 5단계 자가응답만으로는 데이터 조작이 쉽다. 직원이
 *       실제 측정값(예: "38") 또는 증거 문서(스크린샷·CSV·PDF) 를 첨부하면
 *       AI 가 검토해 (a) 1-5 bucket 을 자동 추론하고 (b) 한국어 요약을 남긴다.
 *       이 요약은 result page 와 worklist 에서 다시 사용된다.
 */

import { useRef, useState, useTransition } from "react";
import type { SubItem } from "@/lib/framework/loader";

export interface EvidenceFile {
  url: string;
  name: string;
  size: number;
  mime: string;
  uploaded_at: string;
}

export interface EvidenceAIAnalysis {
  summary: string;
  suggested_bucket: number | null;
  confidence: number;
  flags: string[];
  analyzed_at: string;
  model: string;
}

export interface EvidenceState {
  actual_value?: string;
  notes?: string;
  evidence_files?: EvidenceFile[];
  ai_analysis?: EvidenceAIAnalysis;
}

const ACCEPT_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export function EvidenceInputPanel({
  workspace,
  sub,
  state,
  onChange,
  selectedBucket,
}: {
  workspace: string;
  sub: SubItem;
  state: EvidenceState;
  onChange: (patch: Partial<EvidenceState>) => void;
  /** 사용자가 현재 선택한 5단계 bucket — AI 추론과 비교용 */
  selectedBucket: number | undefined;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const files = state.evidence_files ?? [];
  const ai = state.ai_analysis;

  // 패널 펼침/접힘 — 기본 접힘, 사용자가 헤더 클릭 시 펼침.
  // 단, 이미 입력값/파일/AI 결과가 있다면 자동으로 펼친 상태로 시작 (저장된 데이터 가시성 확보).
  const initialOpen =
    !!state.actual_value?.trim() ||
    !!state.notes?.trim() ||
    (state.evidence_files?.length ?? 0) > 0 ||
    !!state.ai_analysis;
  const [open, setOpen] = useState(initialOpen);

  // 수치 입력 placeholder — evidence options 로부터 추론
  const numericHint = makeNumericHint(sub);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    // 클라이언트 검증
    if (!ACCEPT_MIME.includes(file.type)) {
      setUploadError(
        `지원하지 않는 형식 (${file.type || "unknown"}). PNG/JPG/WEBP/PDF/CSV/XLSX 만 가능.`,
      );
      e.target.value = "";
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setUploadError(
        `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). 최대 10MB.`,
      );
      e.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("workspace", workspace);
      fd.append("sub_item_code", sub.code);
      fd.append("file", file);
      const res = await fetch("/api/evidence/upload", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as {
        ok: boolean;
        file?: EvidenceFile;
        message?: string;
      };
      if (!res.ok || !json.ok || !json.file) {
        setUploadError(json.message ?? "업로드 실패");
        return;
      }
      onChange({ evidence_files: [...files, json.file] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeFile(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    onChange({ evidence_files: next });
  }

  function runAnalyze() {
    setAnalyzeError(null);
    startAnalyze(async () => {
      try {
        const res = await fetch("/api/evidence/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sub_item_code: sub.code,
            actual_value: state.actual_value ?? "",
            notes: state.notes ?? "",
            evidence_files: files,
            selected_bucket: selectedBucket ?? null,
          }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          analysis?: EvidenceAIAnalysis;
          message?: string;
        };
        if (!res.ok || !json.ok || !json.analysis) {
          setAnalyzeError(json.message ?? "분석 실패");
          return;
        }
        onChange({ ai_analysis: json.analysis });
      } catch (err) {
        setAnalyzeError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const hasInput =
    !!state.actual_value?.trim() ||
    !!state.notes?.trim() ||
    files.length > 0;
  const aiMismatch =
    ai &&
    ai.suggested_bucket !== null &&
    selectedBucket !== undefined &&
    Math.abs(ai.suggested_bucket - selectedBucket) >= 2;

  return (
    <div className="mt-5 border-2 border-ink-soft/40 bg-paper-soft/60 p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-baseline justify-between gap-2 flex-wrap mb-0 cursor-pointer text-left hover:opacity-80 transition-opacity"
      >
        <p className="kicker flex items-center gap-2">
          <span className="font-mono text-xs">{open ? "▾" : "▸"}</span>
          증거 입력
        </p>
        <span className="label-mono">
          {hasInput ? "✓ 입력됨" : open ? "권장 — 조작 방지·자동 추론" : "클릭하여 펼치기"}
        </span>
      </button>

      {open ? (
        <>
      <div className="mt-3" />
      {/* 실측 값 + 노트 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="label-mono mb-1 block">실제 측정값</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder={numericHint}
            value={state.actual_value ?? ""}
            onChange={(e) => onChange({ actual_value: e.target.value })}
            className="w-full border-2 border-ink-soft/40 bg-paper px-3 py-2 text-sm font-mono focus:border-ink outline-none"
          />
          <p className="mt-1 label-mono">
            단위/숫자 그대로 입력 (예: <span className="font-mono">38</span>,{" "}
            <span className="font-mono">42%</span>,{" "}
            <span className="font-mono">3.2개월</span>)
          </p>
        </label>

        <label className="block">
          <span className="label-mono mb-1 block">컨텍스트 노트</span>
          <textarea
            rows={2}
            placeholder="언제·어디서·표본 크기 등 (예: 2026-04 활성 교사 80명 설문, 응답 32명)"
            value={state.notes ?? ""}
            onChange={(e) => onChange({ notes: e.target.value })}
            className="w-full border-2 border-ink-soft/40 bg-paper px-3 py-2 text-sm focus:border-ink outline-none resize-none"
          />
        </label>
      </div>

      {/* 파일 업로드 */}
      <div className="mt-4">
        <span className="label-mono mb-2 block">증거 문서 (선택)</span>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 text-sm font-medium border-2 border-ink-soft hover:border-ink hover:bg-paper-deep transition-colors disabled:opacity-50"
          >
            {uploading ? "업로드 중…" : "+ 파일 첨부"}
          </button>
          <span className="label-mono">
            PNG/JPG/PDF/CSV/XLSX · 최대 10MB
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_MIME.join(",")}
          className="hidden"
          onChange={handleFileSelected}
        />
        {uploadError ? (
          <p className="mt-2 text-xs text-signal-red font-mono">
            업로드 오류: {uploadError}
          </p>
        ) : null}
        {files.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {files.map((f, i) => (
              <li
                key={`${f.url}-${i}`}
                className="flex items-center justify-between gap-2 border border-ink-soft/40 bg-paper px-3 py-1.5"
              >
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs truncate flex-1 hover:underline"
                  title={f.name}
                >
                  📎 {f.name}
                </a>
                <span className="label-mono shrink-0">
                  {(f.size / 1024).toFixed(0)}KB
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="label-mono hover:text-signal-red shrink-0"
                  aria-label="제거"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 증거 제출 */}
      {hasInput ? (
        <div className="mt-4 pt-4 border-t border-ink-soft/30">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
            <p className="kicker">증거 제출</p>
            <button
              type="button"
              onClick={runAnalyze}
              disabled={analyzing}
              className="px-3 py-1.5 text-sm font-medium border-2 border-ink hover:bg-ink hover:text-paper transition-colors disabled:opacity-50"
            >
              {analyzing
                ? "검토 중…"
                : ai
                  ? "다시 제출"
                  : "증거 제출"}
            </button>
          </div>

          {analyzeError ? (
            <p className="text-xs text-signal-red font-mono">
              제출 오류: {analyzeError}
            </p>
          ) : null}

          {ai ? (
            <div
              className={`mt-2 border-l-4 pl-3 py-2 ${
                aiMismatch
                  ? "border-signal-amber bg-soft-amber/30"
                  : "border-signal-green bg-soft-green/20"
              }`}
            >
              <p className="text-sm leading-relaxed">{ai.summary}</p>
              <div className="mt-1.5 flex items-baseline gap-3 flex-wrap label-mono">
                {ai.suggested_bucket !== null ? (
                  <span>
                    AI 추론 bucket:{" "}
                    <strong className="font-mono">{ai.suggested_bucket}</strong> /
                    5
                  </span>
                ) : null}
                <span>신뢰도 {(ai.confidence * 100).toFixed(0)}%</span>
                {ai.flags.length > 0
                  ? ai.flags.map((f) => (
                      <span key={f} className="tag tag-gold">
                        {f}
                      </span>
                    ))
                  : null}
              </div>
              {aiMismatch ? (
                <p className="mt-2 text-xs text-signal-amber leading-relaxed">
                  ⚠ 사용자가 선택한 bucket ({selectedBucket}) 과 AI 추론 (
                  {ai.suggested_bucket}) 사이에 격차가 있습니다. 측정값을 다시
                  확인하거나 선택을 조정해 주세요.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-soft leading-relaxed">
              제출하면 Claude 가 입력된 값/문서를 검토해 (a) 5단계 bucket 추론과
              (b) 한국어 요약을 생성합니다. 검증된 증거는 진단 리포트와 워크리스트에
              반영됩니다.
            </p>
          )}
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  );
}

/** evidence options 의 label 에서 numeric 단위 hint 추출 */
function makeNumericHint(sub: SubItem): string {
  const opts = sub.evidence.options;
  if (!opts || opts.length === 0) return "예: 38";
  // 마지막 옵션의 label 사용 (가장 좋은 구간 — 단위 정보 들어있을 확률 높음)
  const labels = opts.map((o) => o.label).join(" / ");
  // % / 개월 / 명 / 시간 단어 감지
  if (/%/.test(labels)) return "예: 38";
  if (/개월/.test(labels)) return "예: 12";
  if (/명/.test(labels)) return "예: 24";
  if (/시간/.test(labels)) return "예: 4";
  if (/회/.test(labels)) return "예: 3";
  return "측정값 (숫자/단위)";
}

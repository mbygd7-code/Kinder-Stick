"use client";

/**
 * Field History Modal — 한 필드의 변경 이력을 보여주는 팝업.
 *
 * 사용:
 *   <FieldHistoryModal workspace="..." field="mau" label="MAU"
 *                       onClose={() => ...} />
 *
 * 표시: 최신순 50개, 변경자 이름·이메일·시각·이전값 → 새값.
 */

import { useEffect, useState } from "react";

interface HistoryItem {
  id: string;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
  changed_by: string | null;
  changed_by_email: string | null;
  changed_by_name: string | null;
  synthesized?: boolean;
}

interface Props {
  workspace: string;
  field: string;
  label: string;
  unit?: string;
  onClose: () => void;
}

function formatValue(v: unknown, unit?: string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    const formatted =
      unit === "₩"
        ? `₩${v.toLocaleString("ko-KR")}`
        : `${v.toLocaleString("ko-KR")}${unit ? ` ${unit}` : ""}`;
    return formatted;
  }
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FieldHistoryModal({
  workspace,
  field,
  label,
  unit,
  onClose,
}: Props) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/ops-context/${encodeURIComponent(workspace)}/history/${encodeURIComponent(field)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) {
          setHistory(d.history as HistoryItem[]);
          setTableMissing(Boolean(d.table_missing));
        } else {
          setErr(d.message ?? "이력 조회 실패");
        }
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workspace, field]);

  // ESC + 외부 클릭 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-2xl w-full bg-paper border-2 border-ink shadow-2xl max-h-[80vh] flex flex-col">
        <header className="sticky top-0 bg-paper border-b-2 border-ink px-5 py-4 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p className="kicker mb-1">변경 이력</p>
            <h3 className="font-display text-xl leading-tight">{label}</h3>
            <p className="label-mono text-ink-soft mt-1">
              필드 키: <span className="font-mono">{field}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="label-mono hover:text-ink border border-ink-soft/40 px-2 py-1 hover:border-ink"
            aria-label="닫기"
          >
            닫기 ✕
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-5">
          {loading ? (
            <p className="label-mono">불러오는 중…</p>
          ) : err ? (
            <div>
              <p className="font-mono text-xs text-signal-red mb-2">⚠ {err}</p>
              <p className="label-mono text-ink-soft leading-relaxed">
                테이블이 아직 준비되지 않았을 수 있습니다 — 관리자가{" "}
                <code className="font-mono">
                  framework/migrations/2026_05_16_ops_context.sql
                </code>{" "}
                를 Supabase 에서 실행해야 이력이 기록됩니다.
              </p>
            </div>
          ) : history.length === 0 ? (
            <div>
              <p className="label-mono text-ink-soft mb-2">
                이 필드는 아직 입력 기록이 없습니다.
              </p>
              {tableMissing ? (
                <p className="font-mono text-xs text-signal-amber leading-relaxed">
                  ⚠ 이력 테이블이 아직 생성되지 않았습니다 — Supabase 에{" "}
                  <code>2026_05_16_ops_context.sql</code> 마이그레이션 실행
                  필요. 실행 후엔 모든 변경이 기록됩니다.
                </p>
              ) : (
                <p className="label-mono text-ink-soft">
                  값을 입력하고 "진단에 반영" 을 누르면 여기에 기록됩니다.
                </p>
              )}
            </div>
          ) : (
            <ol className="space-y-3">
              {history.map((h, i) => {
                const editor =
                  h.changed_by_name ??
                  (h.changed_by_email
                    ? h.changed_by_email.split("@")[0]
                    : "익명");
                const isLatest = i === 0;
                const isInitial = h.old_value === null;
                return (
                  <li
                    key={h.id}
                    className={`border-l-4 pl-4 py-2 ${
                      isLatest
                        ? "border-accent bg-soft-amber/15"
                        : "border-ink-soft/40"
                    }`}
                  >
                    <div className="flex items-baseline gap-2 flex-wrap mb-1">
                      {isLatest ? (
                        <span className="kicker !text-accent">현재 값</span>
                      ) : null}
                      {h.synthesized ? (
                        <span className="label-mono !text-cobalt">
                          서버 상태
                        </span>
                      ) : null}
                      <span className="font-mono text-sm text-ink">
                        {editor}
                      </span>
                      <span className="label-mono opacity-50">·</span>
                      <span className="label-mono">
                        {formatRelative(h.changed_at)}
                      </span>
                      {h.changed_by_email && h.changed_by_name ? (
                        <span className="label-mono opacity-50">
                          ({h.changed_by_email})
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-baseline gap-3 flex-wrap font-display text-lg">
                      {isInitial ? (
                        <span className="label-mono !text-cobalt">
                          최초 입력 →
                        </span>
                      ) : (
                        <>
                          <span className="text-ink-soft line-through">
                            {formatValue(h.old_value, unit)}
                          </span>
                          <span className="font-mono text-base text-ink-soft">
                            →
                          </span>
                        </>
                      )}
                      <span className="text-ink">
                        {formatValue(h.new_value, unit)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <footer className="border-t border-ink-soft/30 px-5 py-3 flex items-baseline justify-between flex-wrap gap-2">
          <p className="label-mono text-ink-soft">
            최대 50개 · 최신순
          </p>
          <p className="label-mono">{history.length}건</p>
        </footer>
      </div>
    </div>
  );
}

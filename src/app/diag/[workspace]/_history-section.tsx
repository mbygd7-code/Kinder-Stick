"use client";

/**
 * 이전 진단 이력 섹션 — Appendix G (D) 영역.
 *
 * /api/diagnosis/list 에서 이 워크스페이스의 진단 목록을 받아 카드 리스트 표시.
 * 카드 클릭 시 결과 패널 인라인 펼침 (페이지 이동 X).
 */

import { useEffect, useState } from "react";
import { getStageLabel } from "@/lib/stage-labels";

interface DiagItem {
  id: string;
  respondent_num: number;
  role: string | null;
  perspective: string | null;
  stage: string | null;
  completed_at: string;
  overall_score: number | null;
  red_critical_count: number | null;
  fp_6m: number | null;
  fp_12m: number | null;
}

interface ListResp {
  ok: boolean;
  count: number;
  items: DiagItem[];
}

export function HistorySection({ workspace }: { workspace: string }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DiagItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/diagnosis/list?workspace=${encodeURIComponent(workspace)}`,
        );
        const json = (await res.json()) as ListResp;
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError("이전 진단 불러오기 실패");
          return;
        }
        setItems(json.items ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  if (loading) {
    return (
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8">
        <p className="label-mono">이전 진단 불러오는 중…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8">
        <p className="label-mono text-signal-red">⚠ {error}</p>
      </section>
    );
  }

  if (items.length === 0) {
    return null; // 첫 진단이면 이력 섹션 숨김
  }

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-12">
      <h2 className="font-display text-2xl sm:text-3xl leading-tight mb-1">
        이전 진단 이력
      </h2>
      <p className="text-sm text-ink-soft mb-5 leading-relaxed">
        총 {items.length}건. 카드를 클릭하면 그 진단의 결과 요약이 같은 자리에 펼쳐집니다.
      </p>

      <ul className="space-y-2">
        {items.map((it) => {
          const isOpen = expandedId === it.id;
          const tone =
            it.overall_score === null
              ? "neutral"
              : it.overall_score >= 70
                ? "green"
                : it.overall_score >= 40
                  ? "amber"
                  : "red";
          return (
            <li
              key={it.id}
              className={`border-2 transition-colors ${
                tone === "red"
                  ? "border-signal-red/60"
                  : tone === "amber"
                    ? "border-signal-amber/60"
                    : tone === "green"
                      ? "border-signal-green/60"
                      : "border-ink-soft/40"
              }`}
            >
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : it.id)}
                className="w-full flex items-center justify-between gap-3 p-4 hover:bg-paper-deep/30 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-sm">
                      {formatDate(it.completed_at)}
                    </span>
                    <span className="label-mono opacity-50">·</span>
                    <span className="label-mono">
                      {it.role ?? "익명"} · 응답 #{it.respondent_num}
                    </span>
                    <span className="label-mono opacity-50">·</span>
                    <span className="label-mono">
                      {it.stage ? getStageLabel(it.stage) : "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-3 flex-wrap">
                    <span
                      className={`font-display text-2xl leading-none ${
                        tone === "red"
                          ? "text-signal-red"
                          : tone === "amber"
                            ? "text-signal-amber"
                            : tone === "green"
                              ? "text-signal-green"
                              : "text-ink"
                      }`}
                    >
                      {it.overall_score ?? "—"}
                    </span>
                    <span className="text-sm text-ink-soft">/ 100</span>
                    {it.red_critical_count && it.red_critical_count > 0 ? (
                      <span className="tag tag-red">
                        빨강 {it.red_critical_count}개
                      </span>
                    ) : null}
                    {it.fp_6m !== null ? (
                      <span className="label-mono">
                        6m: {it.fp_6m}% · 12m: {it.fp_12m ?? "—"}%
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="font-mono text-xl shrink-0">
                  {isOpen ? "−" : "+"}
                </span>
              </button>

              {isOpen ? (
                <div className="border-t border-ink-soft/30 p-4 sm:p-5 space-y-3 bg-paper-soft">
                  <p className="text-sm leading-relaxed">
                    이 진단의 자세한 결과를 보려면:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/diag/${workspace}/result?session=${encodeURIComponent(it.id)}`}
                      className="px-3 py-1.5 border-2 border-ink text-sm font-medium hover:bg-ink hover:text-paper transition-colors"
                    >
                      상세 리포트 보기 →
                    </a>
                    <a
                      href={`/diag/${workspace}/home`}
                      className="px-3 py-1.5 border-2 border-ink-soft text-sm hover:border-ink hover:bg-paper-deep/40 transition-colors"
                    >
                      홈에서 영역별 신호등 보기 →
                    </a>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

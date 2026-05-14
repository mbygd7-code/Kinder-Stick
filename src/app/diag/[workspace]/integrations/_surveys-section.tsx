"use client";

/**
 * Surveys section — /diag/[ws]/integrations 의 NPS/PMF 설문 관리 UI.
 *
 * 표시:
 *   - 활성 설문 (NPS, PMF) 카드 — 응답 수·점수·share-link·종료 버튼
 *   - 종료된 설문 이력 (간단 리스트)
 *   - "새 설문 시작" 버튼 (이미 active 면 disabled)
 */

import { useEffect, useState, useTransition } from "react";
import {
  SURVEY_LABEL,
  MIN_RESPONSES,
  STALE_DAYS,
  type SurveyKind,
} from "@/lib/surveys/types";

interface SurveyListRow {
  id: string;
  kind: SurveyKind;
  share_token: string;
  title: string;
  status: "active" | "closed";
  created_at: string;
  closed_at: string | null;
  response_count: number;
  score_label: string | null; // "NPS +18" / "VD 38%" / null if unknown
  evidence_v: number | null;
  reliable: boolean;
}

interface Props {
  workspace: string;
}

export function SurveysSection({ workspace }: Props) {
  const [active, setActive] = useState<SurveyListRow[]>([]);
  const [history, setHistory] = useState<SurveyListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<SurveyKind | null>(null);
  const [pending, startPending] = useTransition();

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      // 활성·종료 합쳐서 가져오기 — 별도 list endpoint 가 없으니 서버측
      // helper 가 없는 경우엔 클라이언트에서 active 만 fetch.
      // 더 간단히: results endpoint 를 활성 설문 1개씩 호출 → 비용 약함.
      const res = await fetch(`/api/surveys/list?workspace=${encodeURIComponent(workspace)}`);
      if (!res.ok) {
        setErr("설문 목록 조회 실패");
        return;
      }
      const data = await res.json();
      const rows = (data.surveys ?? []) as SurveyListRow[];
      setActive(rows.filter((r) => r.status === "active"));
      setHistory(rows.filter((r) => r.status === "closed").slice(0, 8));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  function createSurvey(kind: SurveyKind) {
    setCreatingKind(kind);
    setErr(null);
    startPending(async () => {
      const res = await fetch("/api/surveys/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspace, kind }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.message ?? "생성 실패");
        setCreatingKind(null);
        return;
      }
      setCreatingKind(null);
      await refresh();
    });
  }

  async function closeSurvey(token: string) {
    if (!confirm("이 설문을 종료할까요? 종료 후엔 응답을 받지 않습니다.")) return;
    const res = await fetch(`/api/surveys/${token}/close`, { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      alert(`종료 실패: ${data.message ?? "unknown"}`);
      return;
    }
    await refresh();
  }

  function copyLink(kind: SurveyKind, token: string) {
    const url = `${window.location.origin}/survey/${kind}/${token}`;
    navigator.clipboard
      .writeText(url)
      .then(() => alert(`링크 복사됨: ${url}`))
      .catch(() => alert(url));
  }

  const hasActiveNps = active.some((s) => s.kind === "nps");
  const hasActivePmf = active.some((s) => s.kind === "pmf");

  return (
    <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-16">
      <div className="divider-ornament">
        <span className="font-mono text-xs uppercase tracking-widest">
          § Internal Surveys — NPS · Sean Ellis (PMF)
        </span>
      </div>

      <div className="mt-6 mb-6 flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <p className="kicker mb-1">자체 설문 (외부 도구 의존 X)</p>
          <h2 className="font-display text-2xl sm:text-3xl tracking-tight leading-tight">
            교사·사용자 설문을 우리 시스템 안에서
          </h2>
          <p className="mt-1 label-mono">
            응답 {MIN_RESPONSES}건 모이면 진단의 A13.NPS.SCORE / A2.SE.40 evidence 로 자동 반영
          </p>
        </div>
      </div>

      {err ? (
        <p className="mb-4 font-mono text-xs text-signal-red">⚠ {err}</p>
      ) : null}

      {/* 새 설문 시작 버튼 2개 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        <button
          type="button"
          onClick={() => createSurvey("nps")}
          disabled={hasActiveNps || pending}
          className="btn-secondary disabled:opacity-40 text-left flex items-center justify-between"
          title={hasActiveNps ? "이미 진행 중인 NPS 설문이 있습니다" : ""}
        >
          <span>
            <span className="kicker">NPS</span>
            <span className="block font-display text-base mt-1">
              {hasActiveNps
                ? "이미 진행 중"
                : creatingKind === "nps" && pending
                  ? "생성 중…"
                  : "+ 새 NPS 설문 시작"}
            </span>
          </span>
          <span className="font-mono text-xs">→</span>
        </button>
        <button
          type="button"
          onClick={() => createSurvey("pmf")}
          disabled={hasActivePmf || pending}
          className="btn-secondary disabled:opacity-40 text-left flex items-center justify-between"
          title={
            hasActivePmf ? "이미 진행 중인 PMF 설문이 있습니다" : ""
          }
        >
          <span>
            <span className="kicker">Sean Ellis · PMF</span>
            <span className="block font-display text-base mt-1">
              {hasActivePmf
                ? "이미 진행 중"
                : creatingKind === "pmf" && pending
                  ? "생성 중…"
                  : "+ 새 PMF 테스트 시작"}
            </span>
          </span>
          <span className="font-mono text-xs">→</span>
        </button>
      </div>

      {/* 활성 설문 카드들 */}
      {loading ? (
        <p className="label-mono">설문 목록 로딩 중…</p>
      ) : active.length === 0 ? (
        <p className="note-box">
          진행 중인 설문이 없습니다. 위 버튼으로 시작하세요.
        </p>
      ) : (
        <ul className="space-y-4">
          {active.map((s) => {
            const ageDays = Math.floor(
              (Date.now() - new Date(s.created_at).getTime()) /
                (1000 * 60 * 60 * 24),
            );
            const stale = ageDays > STALE_DAYS;
            const tone = s.reliable
              ? "border-signal-green bg-soft-green/15"
              : "border-cobalt/50 bg-soft-cobalt/15";
            return (
              <li key={s.id} className={`border-2 ${tone} p-5`}>
                <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
                  <div className="flex items-baseline gap-3 flex-wrap min-w-0">
                    <span
                      className={`kicker ${
                        s.kind === "nps" ? "!text-cobalt" : "!text-accent"
                      }`}
                    >
                      🟢 ACTIVE · {SURVEY_LABEL[s.kind]}
                    </span>
                    <span className="font-display text-lg leading-tight">
                      {s.title}
                    </span>
                  </div>
                  <span className="label-mono">{ageDays}일 진행</span>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm mb-4">
                  <div>
                    <dt className="label-mono">응답</dt>
                    <dd className="font-display text-xl leading-none">
                      {s.response_count}
                      <span className="font-mono text-xs text-ink-soft">
                        /{MIN_RESPONSES}+
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="label-mono">점수</dt>
                    <dd className="font-display text-xl leading-none">
                      {s.reliable ? s.score_label : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-mono">진단 반영</dt>
                    <dd className="font-mono text-sm">
                      {s.evidence_v !== null
                        ? `v=${s.evidence_v} (자동)`
                        : "보류 (응답 부족)"}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-mono">신선도</dt>
                    <dd className="font-mono text-sm">
                      {stale ? (
                        <span className="!text-signal-amber">stale ({STALE_DAYS}d+)</span>
                      ) : (
                        "fresh"
                      )}
                    </dd>
                  </div>
                </dl>

                {/* Share URL */}
                <div className="border-t border-ink-soft/30 pt-3 mb-3">
                  <p className="label-mono mb-1">공유 링크</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-mono text-xs bg-paper-deep px-2 py-1 break-all flex-1">
                      {typeof window !== "undefined"
                        ? `${window.location.origin}/survey/${s.kind}/${s.share_token}`
                        : `/survey/${s.kind}/${s.share_token}`}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyLink(s.kind, s.share_token)}
                      className="label-mono hover:text-ink border border-ink-soft/40 px-2 py-1 hover:border-ink"
                    >
                      복사
                    </button>
                  </div>
                  <p className="mt-1 label-mono text-ink-soft">
                    교사·사용자에게 이 링크를 공유하세요. 응답은 익명이며
                    로그인 없이 가능합니다.
                  </p>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <a
                    href={`/survey/${s.kind}/${s.share_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="label-mono hover:text-ink border border-ink-soft/40 px-2 py-1 hover:border-ink"
                  >
                    응답 페이지 미리보기 →
                  </a>
                  <button
                    type="button"
                    onClick={() => closeSurvey(s.share_token)}
                    className="ml-auto label-mono !text-signal-red hover:underline"
                  >
                    설문 종료
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 종료된 설문 이력 */}
      {history.length > 0 ? (
        <div className="mt-10">
          <p className="kicker mb-3">최근 종료된 설문 ({history.length})</p>
          <ul className="space-y-1">
            {history.map((s) => (
              <li
                key={s.id}
                className="text-sm py-2 border-b border-ink-soft/20 flex items-baseline gap-3 flex-wrap"
              >
                <span className="label-mono">⚪</span>
                <span className="kicker">{SURVEY_LABEL[s.kind]}</span>
                <span className="text-ink">{s.title}</span>
                <span className="label-mono text-ink-soft">
                  · {s.response_count}명
                </span>
                {s.score_label ? (
                  <span className="label-mono">· {s.score_label}</span>
                ) : null}
                <span className="ml-auto label-mono">
                  {s.closed_at?.slice(0, 10) ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

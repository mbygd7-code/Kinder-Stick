"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface ActionRow {
  id: string;
  session_id: string;
  title: string;
  smart_payload: Record<string, unknown> & {
    owner?: string;
    deadline_days?: number;
    action?: string;
    verification_metric?: string;
  };
  owner_role: string | null;
  deadline: string | null;
  status: string;
  verification_metric: Record<string, unknown> | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_ORDER = [
  "accepted",
  "in_progress",
  "completed",
  "verified",
  "abandoned",
] as const;

const STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  in_progress: "In progress",
  completed: "Completed",
  verified: "Verified",
  abandoned: "Abandoned",
};

const ISSUE_DATE = formatDate(new Date());

interface Result {
  ok: boolean;
  processed?: number;
  overdue_total?: number;
  transitioned?: number;
  message?: string;
}

export function ActionsBoard({
  workspace,
  actions,
  sessions,
}: {
  workspace: string;
  actions: ActionRow[];
  sessions: Record<string, { domain_code: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cronResult, setCronResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out: Record<string, ActionRow[]> = {};
    for (const s of STATUS_ORDER) out[s] = [];
    for (const a of actions) {
      (out[a.status] ?? (out[a.status] = [])).push(a);
    }
    return out;
  }, [actions]);

  const overdueCount = useMemo(() => {
    const now = Date.now();
    return actions.filter(
      (a) =>
        (a.status === "accepted" || a.status === "in_progress") &&
        a.deadline &&
        new Date(a.deadline).getTime() < now,
    ).length;
  }, [actions]);

  function setStatus(id: string, newStatus: string) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/agent/actions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, status: newStatus }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message ?? "상태 변경 실패");
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function runCron() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/cron/follow-up", { method: "POST" });
        const json: Result = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message ?? "cron 실패");
          return;
        }
        setCronResult(json);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <main className="min-h-dvh w-full pb-20">
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <a
              href={`/diag/${workspace}/home`}
              className="kicker hover:text-ink"
            >
              ← 홈
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              {workspace} / actions
            </span>
          </div>
          <span className="label-mono">ACTION BOARD</span>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-4">No. 07 · 채택된 SMART 액션</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Action{" "}
          <span className="text-accent italic font-display">Board</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          코치가 제안한 SMART 액션 중 채택한 것들의 상태를 추적합니다. 만료된
          액션은 follow-up cron 으로 자동 감지되어 KPI Signal Feed 에 알림이
          쌓입니다.
        </p>

        <div className="mt-6 flex items-center gap-2 flex-wrap">
          <span className="tag tag-filled">총 {actions.length}건</span>
          {overdueCount > 0 ? (
            <span className="tag tag-red">overdue {overdueCount}</span>
          ) : (
            <span className="tag tag-green">on track</span>
          )}
        </div>
      </section>

      {/* CRON CTA */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-4">
        <div className="area-card flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div>
            <p className="kicker mb-1">Follow-up cron</p>
            <p className="font-display text-lg">
              만료된 액션을 점검하고 Signal Feed 에 narrative 추가
            </p>
            <p className="mt-1 label-mono">
              production 에서는 매일 09:00 KST (vercel cron). 로컬에선 수동.
            </p>
          </div>
          <button
            type="button"
            onClick={runCron}
            disabled={pending}
            className="btn-primary disabled:opacity-50"
          >
            {pending ? "실행 중…" : "지금 실행"}
            <span className="font-mono text-xs">→</span>
          </button>
        </div>
        {cronResult ? (
          <div className="mt-3 note-box font-mono text-xs">
            processed {cronResult.processed} · transitioned{" "}
            {cronResult.transitioned} · overdue total{" "}
            {cronResult.overdue_total}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 area-card !border-signal-red bg-soft-red/30">
            <p className="kicker !text-signal-red mb-1">Error</p>
            <pre className="font-mono text-xs whitespace-pre-wrap">{error}</pre>
          </div>
        ) : null}
      </section>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-10">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § By status
          </span>
        </div>
      </div>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 space-y-10">
        {STATUS_ORDER.map((s) => {
          const list = grouped[s] ?? [];
          if (list.length === 0) return null;
          return (
            <div key={s}>
              <header className="flex items-baseline justify-between mb-4">
                <h2 className="font-display text-2xl">
                  <span className="kicker section-num mr-2">§</span>
                  {STATUS_LABEL[s]}
                </h2>
                <span className="label-mono">{list.length}</span>
              </header>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {list.map((a) => (
                  <ActionCard
                    key={a.id}
                    action={a}
                    domainCode={sessions[a.session_id]?.domain_code}
                    workspace={workspace}
                    onSetStatus={setStatus}
                    pending={pending}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {actions.length === 0 ? (
          <div className="note-box">
            아직 채택된 액션이 없습니다. 도메인 코치 페이지에서 SMART 액션을
            채택해 주세요. (예:{" "}
            <a
              href={`/diag/${workspace}/coach/A2`}
              className="underline hover:text-accent"
            >
              /diag/{workspace}/coach/A2
            </a>
            )
          </div>
        ) : null}
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a href={`/diag/${workspace}/result`} className="label-mono hover:text-ink">
          ← back to result
        </a>
        <p className="label-mono">{ISSUE_DATE} · action board v1</p>
      </footer>
    </main>
  );
}

function ActionCard({
  action,
  domainCode,
  workspace,
  onSetStatus,
  pending,
}: {
  action: ActionRow;
  domainCode: string | undefined;
  workspace: string;
  onSetStatus: (id: string, status: string) => void;
  pending: boolean;
}) {
  const deadline = action.deadline ? new Date(action.deadline) : null;
  const daysLeft = deadline
    ? Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const overdue =
    deadline !== null &&
    daysLeft !== null &&
    daysLeft < 0 &&
    (action.status === "accepted" || action.status === "in_progress");

  return (
    <article
      data-action-id={action.id}
      className={`area-card ${overdue ? "!border-signal-red bg-soft-red/30" : ""}`}
    >
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="kicker">{action.owner_role ?? "—"}</span>
          {domainCode ? (
            <a
              href={`/diag/${workspace}/coach/${domainCode}`}
              className="tag tag-filled hover:bg-accent hover:border-accent transition-colors"
              title="해당 도메인 코치로 이동"
            >
              {domainCode}
            </a>
          ) : null}
        </div>
        <span
          className={`tag ${
            action.status === "verified" || action.status === "completed"
              ? "tag-green"
              : action.status === "abandoned"
                ? "tag-red"
                : overdue
                  ? "tag-red"
                  : "tag-filled"
          }`}
        >
          {overdue ? "OVERDUE · " : ""}
          {action.status}
        </span>
      </header>

      <p className="mt-3 font-display text-lg leading-snug">{action.title}</p>

      <IntegrationBadges payload={action.smart_payload} />

      <div className="mt-3 flex items-center gap-2 flex-wrap label-mono">
        {deadline ? (
          <span>
            deadline · {formatDate(deadline)}
            {daysLeft !== null
              ? daysLeft >= 0
                ? ` (D-${daysLeft})`
                : ` (${-daysLeft}d 지남)`
              : ""}
          </span>
        ) : null}
        {action.verification_metric &&
        typeof action.verification_metric.description === "string" ? (
          <>
            <span>·</span>
            <span>
              {action.verification_metric.description as string}
            </span>
          </>
        ) : null}
      </div>

      <div className="mt-4 dotted-rule pt-3 flex flex-wrap gap-2">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSetStatus(action.id, s)}
            disabled={action.status === s || pending}
            className={`text-xs px-2 py-1 border transition ${
              action.status === s
                ? "bg-ink text-paper border-ink cursor-default"
                : "bg-paper border-ink-soft hover:border-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </article>
  );
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface IntegrationDispatch {
  ok: boolean;
  mock: boolean;
  configured?: boolean;
  external_url?: string;
  error?: string;
  dispatched_at?: string;
}

function IntegrationBadges({
  payload,
}: {
  payload: ActionRow["smart_payload"];
}) {
  const integrations = (payload as { integrations?: { notion?: IntegrationDispatch; slack?: IntegrationDispatch } } | null)
    ?.integrations;
  if (!integrations) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Badge label="Notion" disp={integrations.notion} url={integrations.notion?.external_url} />
      <Badge label="Slack" disp={integrations.slack} />
    </div>
  );
}

function Badge({
  label,
  disp,
  url,
}: {
  label: string;
  disp?: IntegrationDispatch;
  url?: string;
}) {
  if (!disp) return null;
  const failed = !disp.ok;
  const mock = disp.mock;
  const tone = failed
    ? "tag-red"
    : mock
      ? ""
      : "tag-green";
  const text = failed
    ? `${label} ✗`
    : mock
      ? `${label} (mock)`
      : `→ ${label}`;
  const inner = (
    <span className={`tag ${tone}`} title={failed ? disp.error : undefined}>
      {text}
    </span>
  );
  if (url && !failed && !mock) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return inner;
}

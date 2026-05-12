"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Domain } from "@/lib/framework/loader";

// ============================================================
// Types
// ============================================================

interface AgentEvidence {
  kind: string;
  source_id: string;
  summary: string;
}
interface AgentNextStep {
  kind: string;
  prompt: string;
}
interface AgentSmartAction {
  owner: string;
  deadline_days: number;
  action: string;
  verification_metric?: string;
}
interface AgentActionVerification {
  action_id: string;
  new_status: string;
  measurement?: string;
  rationale?: string;
}

interface VerificationResult {
  action_id: string;
  matched: boolean;
  applied: boolean;
  prev_status?: string;
  new_status?: string;
  reason?: string;
}

interface AgentReply {
  finding: string | null;
  severity: number;
  confidence: number | null;
  next_step: AgentNextStep | null;
  smart_actions: AgentSmartAction[];
  evidence: AgentEvidence[];
  action_verifications?: AgentActionVerification[];
}

interface MessageRow {
  id: string;
  role: "user" | "agent" | "external_expert" | "tool_result";
  content: Record<string, unknown>;
  created_at: string;
}

interface ExpertContent {
  expert_finding?: string;
  citations?: Array<{ kind: string; source_id: string; summary: string }>;
  recommended_actions?: Array<{
    title: string;
    deadline_days: number;
    owner_hint: string;
    risk_if_skipped: string;
  }>;
  confidence?: number;
  follow_up_questions?: string[];
  provider?: string;
  domain?: string;
  cost_krw?: number;
  _note?: string;
}

interface ActionRow {
  id: string;
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
  created_at: string;
}

export interface SessionBootstrap {
  session_id: string;
  state: string;
  severity: number;
  summary: string | null;
  opened_at: string;
  messages: MessageRow[];
  actions: ActionRow[];
}

interface UsageStats {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface SessionStartResponse {
  ok: boolean;
  session_id?: string;
  state?: string;
  domain_score?: number | null;
  matched_playbooks?: Array<{
    id: string;
    title: string;
    diagnostic_q: string;
    cite: string;
  }>;
  agent?: AgentReply;
  raw?: string | null;
  usage?: UsageStats;
  message?: string;
}

interface MessageResponse {
  ok: boolean;
  message_id?: string;
  state?: string;
  agent?: AgentReply | null;
  verification_results?: VerificationResult[];
  raw?: string | null;
  usage?: UsageStats;
  message?: string;
}

interface ActionCreateResponse {
  ok: boolean;
  action?: ActionRow;
  message?: string;
}

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

// ============================================================
// Component
// ============================================================

export function CoachClient({
  workspace,
  domain,
  bootstrap,
}: {
  workspace: string;
  domain: Domain;
  bootstrap: SessionBootstrap | null;
}) {
  // Session state
  const [sessionId, setSessionId] = useState<string | null>(
    bootstrap?.session_id ?? null,
  );
  const [state, setState] = useState<string>(bootstrap?.state ?? "idle");
  const [domainScore, setDomainScore] = useState<number | null>(null);
  const [matchedPlaybooks, setMatchedPlaybooks] = useState<
    NonNullable<SessionStartResponse["matched_playbooks"]>
  >([]);

  // Messages — initialize from bootstrap, append on each turn
  const [messages, setMessages] = useState<MessageRow[]>(
    bootstrap?.messages ?? [],
  );
  const [actions, setActions] = useState<ActionRow[]>(bootstrap?.actions ?? []);
  const [lastVerifications, setLastVerifications] = useState<
    VerificationResult[]
  >([]);
  const [latestAgent, setLatestAgent] = useState<AgentReply | null>(() =>
    extractLatestAgent(bootstrap?.messages ?? []),
  );
  const [latestRaw, setLatestRaw] = useState<string | null>(null);

  const [usage, setUsage] = useState<{
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null>(null);

  // I/O
  const [starting, startStarting] = useTransition();
  const [sending, startSending] = useTransition();
  const [accepting, startAccepting] = useTransition();
  const [escalating, startEscalating] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [userInput, setUserInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-start a session if none exists
  const triedAutoStart = useRef(false);
  useEffect(() => {
    if (!sessionId && !triedAutoStart.current) {
      triedAutoStart.current = true;
      startSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, latestAgent]);

  // ---- Handlers ----

  function startSession() {
    setError(null);
    startStarting(async () => {
      try {
        const res = await fetch("/api/agent/sessions/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspace,
            domain_code: domain.code,
          }),
        });
        const json: SessionStartResponse = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message ?? "세션 시작 실패");
          return;
        }
        setSessionId(json.session_id ?? null);
        setState(json.state ?? "analyzing");
        setDomainScore(json.domain_score ?? null);
        setMatchedPlaybooks(json.matched_playbooks ?? []);
        setLatestAgent(json.agent ?? null);
        setLatestRaw(json.raw ?? null);
        setUsage(json.usage ?? null);
        // append initial agent message into messages
        if (json.agent) {
          setMessages((prev) => [
            ...prev,
            {
              id: `local-agent-${Date.now()}`,
              role: "agent",
              content: json.agent as unknown as Record<string, unknown>,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function sendMessage() {
    if (!sessionId || !userInput.trim() || sending) return;
    const text = userInput.trim();
    setUserInput("");
    setError(null);

    // Optimistic user message
    const localUser: MessageRow = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: { text },
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localUser]);

    startSending(async () => {
      try {
        const res = await fetch("/api/agent/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, user_message: text }),
        });
        const json: MessageResponse = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message ?? "메시지 전송 실패");
          return;
        }
        setState(json.state ?? state);
        setLatestAgent(json.agent ?? latestAgent);
        setLatestRaw(json.raw ?? null);
        setUsage(json.usage ?? null);
        setLastVerifications(json.verification_results ?? []);
        // Apply verification results to local actions list (so the board updates immediately)
        if (json.verification_results && json.verification_results.length > 0) {
          setActions((prev) =>
            prev.map((a) => {
              const vr = json.verification_results!.find(
                (v) => v.applied && a.id.startsWith(v.action_id),
              );
              return vr?.new_status ? { ...a, status: vr.new_status } : a;
            }),
          );
        }
        if (json.agent) {
          setMessages((prev) => [
            ...prev,
            {
              id: json.message_id ?? `local-agent-${Date.now()}`,
              role: "agent",
              content: json.agent as unknown as Record<string, unknown>,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function acceptAction(action: AgentSmartAction, idx: number) {
    if (!sessionId) return;
    startAccepting(async () => {
      try {
        const res = await fetch("/api/agent/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            title: action.action,
            smart_payload: action,
            owner_role: action.owner,
            deadline_days: action.deadline_days,
            verification_metric: action.verification_metric,
          }),
        });
        const json: ActionCreateResponse = await res.json();
        if (!res.ok || !json.ok || !json.action) {
          setError(json.message ?? "액션 채택 실패");
          return;
        }
        setActions((prev) => [...prev, json.action!]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function escalateExternal() {
    if (!sessionId) return;
    setError(null);
    startEscalating(async () => {
      try {
        const res = await fetch("/api/agent/external-handoff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message ?? "external handoff 실패");
          return;
        }
        // Append external_expert message to thread
        if (json.expert) {
          setMessages((prev) => [
            ...prev,
            {
              id: json.agent_message_id ?? `local-expert-${Date.now()}`,
              role: "external_expert",
              content: {
                ...json.expert,
                provider: json.mock ? "mock_expert" : "meetflow",
                _note: json.mock
                  ? "Mock response — Meetflow not configured"
                  : "Real Meetflow expert",
              },
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function changeActionStatus(actionId: string, newStatus: string) {
    try {
      const res = await fetch("/api/agent/actions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: actionId, status: newStatus }),
      });
      const json: ActionCreateResponse = await res.json();
      if (!res.ok || !json.ok || !json.action) {
        setError(json.message ?? "상태 변경 실패");
        return;
      }
      setActions((prev) =>
        prev.map((a) => (a.id === actionId ? { ...a, ...json.action! } : a)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const acceptedActionTitles = useMemo(
    () => new Set(actions.map((a) => a.title)),
    [actions],
  );
  const loadingFirst = starting && messages.length === 0;

  // ============================================================
  // Render
  // ============================================================

  return (
    <main className="min-h-dvh w-full pb-32">
      {/* MASTHEAD */}
      <header className="border-b-2 border-ink">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3 flex-wrap">
            <a href={`/diag/${workspace}/home`} className="kicker hover:text-ink">
              ← 홈
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              {workspace} / coach / {domain.code}
            </span>
          </div>
          <span className="label-mono">AI COACHING SESSION · {state}</span>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-3">No. {domain.code} · {domain.name_en} Coach</p>
        <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] tracking-tight">
          {domain.name_ko}
        </h1>
        <p className="mt-4 max-w-3xl text-base text-ink-soft leading-relaxed">
          전문 분야 — {domain.framework}
        </p>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className={`tag tag-${tierColor(domain.tier)}`}>
            {domain.tier.toUpperCase()}
          </span>
          <span className="tag">가중치 {domain.weight}%</span>
          <span className="tag">담당 {domain.owner_role.join(" / ")}</span>
        </div>
      </section>

      {/* HEAD METRICS */}
      {(latestAgent || domainScore !== null) ? (
        <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric
            label="Domain score"
            value={
              domainScore === null || domainScore === undefined
                ? "—"
                : Math.round(domainScore).toString()
            }
            sub="0–100"
          />
          <Metric
            label="Severity"
            value={String(latestAgent?.severity ?? bootstrap?.severity ?? "—")}
            sub="1–5"
            tone={
              (latestAgent?.severity ?? bootstrap?.severity ?? 0) >= 4
                ? "red"
                : (latestAgent?.severity ?? bootstrap?.severity ?? 0) >= 3
                  ? "amber"
                  : "green"
            }
          />
          <Metric
            label="Confidence"
            value={
              latestAgent?.confidence === null ||
              latestAgent?.confidence === undefined
                ? "—"
                : `${Math.round((latestAgent.confidence ?? 0) * 100)}%`
            }
            sub="agent self-report"
          />
          <Metric
            label="Tokens (last)"
            value={
              usage
                ? `${usage.input_tokens}/${usage.output_tokens}`
                : "—"
            }
            sub={
              usage &&
              ((usage.cache_read_input_tokens ?? 0) > 0 ||
                (usage.cache_creation_input_tokens ?? 0) > 0)
                ? `cache: ${usage.cache_read_input_tokens ?? 0} read / ${usage.cache_creation_input_tokens ?? 0} write`
                : "in / out"
            }
          />
        </section>
      ) : null}

      {/* DIVIDER */}
      <div className="max-w-5xl mx-auto px-6 sm:px-10 mt-8">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Conversation
          </span>
        </div>
      </div>

      {/* LOADING */}
      {loadingFirst ? (
        <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8">
          <div className="area-card">
            <p className="kicker mb-2">Analyzing</p>
            <h2 className="font-display text-2xl">코치가 응답을 분석 중…</h2>
            <p className="mt-2 text-ink-soft">
              진단 응답을 retrieve하고, playbook을 매칭하고, Claude 4.6 Sonnet에 분석을 요청합니다. 보통 20–30초 걸립니다.
            </p>
            <div className="mt-4 bar-track">
              <div className="bar-fill accent" style={{ width: "33%" }} />
            </div>
          </div>
        </section>
      ) : null}

      {/* ERROR */}
      {error ? (
        <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-6">
          <div className="area-card !border-signal-red bg-soft-red/30">
            <p className="kicker !text-signal-red mb-1">Error</p>
            <pre className="font-mono text-xs whitespace-pre-wrap">{error}</pre>
          </div>
        </section>
      ) : null}

      {/* VERIFICATION BANNER (last turn) */}
      {lastVerifications.length > 0 ? (
        <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-6">
          <div className="area-card !border-signal-green bg-soft-green/40">
            <p className="kicker mb-2 !text-signal-green">
              Action verifications applied · {lastVerifications.filter((v) => v.applied).length} / {lastVerifications.length}
            </p>
            <ul className="space-y-1.5">
              {lastVerifications.map((v) => (
                <li
                  key={v.action_id}
                  className="flex items-baseline gap-3 text-sm font-mono"
                >
                  <span
                    className={`tag ${v.applied ? "tag-green" : "tag-red"}`}
                  >
                    {v.applied ? "APPLIED" : "SKIPPED"}
                  </span>
                  <span>#{v.action_id}</span>
                  <span>·</span>
                  <span>
                    {v.prev_status ?? "?"} → {v.new_status ?? v.reason ?? "?"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* ESCALATE TO EXTERNAL */}
      {sessionId &&
      ["A5", "A7", "A11"].includes(domain.code) &&
      latestAgent &&
      latestAgent.severity >= 3 ? (
        <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-6">
          <div className="area-card !border-cobalt bg-soft-cobalt/40">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="kicker mb-1" style={{ color: "var(--cobalt)" }}>
                  External AI consultation
                </p>
                <h2 className="font-display text-xl">
                  {{
                    A5: "세무·회계 전문가 자문",
                    A7: "규제·개인정보 전문가 자문",
                    A11: "스타트업 법률 자문",
                  }[domain.code as "A5" | "A7" | "A11"]}
                </h2>
                <p className="mt-1 label-mono">
                  PII 자동 마스킹 + HMAC 서명. Meetflow 미설정 시 mock 전문가
                  (Claude 특화 프롬프트)로 시뮬레이션.
                </p>
              </div>
              <button
                type="button"
                onClick={escalateExternal}
                disabled={escalating}
                className="btn-primary disabled:opacity-50"
              >
                {escalating ? "자문 진행 중…" : "외부 전문가에 escalate"}
                <span className="font-mono text-xs">→</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* MESSAGE THREAD */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8 space-y-6">
        {messages.map((m) => (
          <MessageBlock
            key={m.id}
            message={m}
            onAcceptAction={(action, i) => acceptAction(action, i)}
            acceptedTitles={acceptedActionTitles}
            accepting={accepting}
          />
        ))}
        {sending ? (
          <div className="area-card">
            <p className="kicker">코치 작성 중…</p>
            <div className="mt-3 bar-track">
              <div className="bar-fill accent" style={{ width: "33%" }} />
            </div>
          </div>
        ) : null}
        {latestRaw ? (
          <div className="area-card">
            <p className="kicker !text-signal-red mb-2">Raw output (parse failed)</p>
            <pre className="font-mono text-xs whitespace-pre-wrap">{latestRaw}</pre>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </section>

      {/* ACCEPTED ACTIONS LIST */}
      {actions.length > 0 ? (
        <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-12">
          <div className="divider-ornament mb-6">
            <span className="font-mono text-xs uppercase tracking-widest">
              § Accepted actions · {actions.length}
            </span>
          </div>
          <div className="space-y-3">
            {actions.map((a) => (
              <AcceptedAction
                key={a.id}
                action={a}
                onChangeStatus={changeActionStatus}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* MATCHED PLAYBOOKS (only on first turn) */}
      {matchedPlaybooks.length > 0 ? (
        <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-12">
          <div className="divider-ornament mb-6">
            <span className="font-mono text-xs uppercase tracking-widest">
              § Matched playbooks · {matchedPlaybooks.length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {matchedPlaybooks.map((p) => (
              <article key={p.id} className="metric-card">
                <span className="kicker">{p.id}</span>
                <h3 className="mt-1 font-display text-lg leading-tight">
                  {p.title}
                </h3>
                <p className="mt-2 text-sm text-ink-soft">Q. {p.diagnostic_q}</p>
                <p className="mt-2 label-mono">cite: {p.cite}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* STICKY INPUT */}
      {sessionId ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t-2 border-ink paper-bg">
          <div className="max-w-5xl mx-auto px-6 sm:px-10 py-4 flex items-center gap-3">
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={
                latestAgent?.next_step?.kind === "diagnostic_question"
                  ? "코치 질문에 답하세요. (Cmd/Ctrl+Enter 전송)"
                  : "추가 질문이나 정보를 입력… (Cmd/Ctrl+Enter 전송)"
              }
              rows={2}
              disabled={sending}
              className="evidence-input flex-1 resize-none"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={sending || !userInput.trim()}
              className="btn-primary !py-3 !px-5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "전송 중…" : "전송"}
              <span className="font-mono text-xs">→</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Sticky exit footer — 코치 종료 후 어디로 가야 하나 명확히 (G2) */}
      <div className="fixed bottom-0 left-0 right-0 border-t-2 border-ink bg-paper/95 backdrop-blur-sm z-20 print:hidden">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap min-w-0">
            <span className="label-mono">
              {domain.code} · {domain.name_ko}
            </span>
            {actions.length > 0 ? (
              <span className="label-mono">
                · 채택된 액션 {actions.length}건
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <a
              href={`/diag/${workspace}/home`}
              className="px-3 py-1.5 text-sm font-medium border border-ink-soft hover:border-ink hover:bg-paper-deep transition-colors"
            >
              ← 홈으로
            </a>
            <a
              href={`/diag/${workspace}/actions`}
              className="px-3 py-1.5 text-sm font-medium border border-ink-soft hover:border-ink hover:bg-paper-deep transition-colors"
            >
              액션 보드 →
            </a>
            <a
              href={`/diag/${workspace}/worklist`}
              className="px-3 py-1.5 text-sm font-medium border-2 border-ink hover:bg-ink hover:text-paper transition-colors"
            >
              워크리스트 실행 →
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

// ============================================================
// Sub-components
// ============================================================

function MessageBlock({
  message,
  onAcceptAction,
  acceptedTitles,
  accepting,
}: {
  message: MessageRow;
  onAcceptAction: (action: AgentSmartAction, idx: number) => void;
  acceptedTitles: Set<string>;
  accepting: boolean;
}) {
  if (message.role === "external_expert") {
    return <ExternalExpertBlock message={message} />;
  }
  if (message.role === "user") {
    const text =
      typeof message.content?.text === "string"
        ? (message.content.text as string)
        : JSON.stringify(message.content);
    return (
      <article className="ml-auto max-w-[85%] border-2 border-ink-soft/60 bg-paper-deep p-5">
        <p className="t-label mb-2">내 답변</p>
        <p className="t-body whitespace-pre-wrap">{text}</p>
        <p className="mt-3 t-label pt-2 border-t border-ink-soft/30">
          {formatTime(message.created_at)}
        </p>
      </article>
    );
  }

  // agent
  const agent = parseAgentContent(message.content);
  if (!agent) {
    return (
      <article className="border-2 border-signal-red bg-soft-red/30 p-5">
        <p className="t-label-accent mb-2">파싱 실패</p>
        <pre className="mt-2 font-mono text-xs whitespace-pre-wrap">
          {message.content?.raw
            ? String(message.content.raw)
            : JSON.stringify(message.content, null, 2)}
        </pre>
      </article>
    );
  }

  return (
    <article className="border-2 border-ink bg-paper p-6 sm:p-7">
      {/* ── Header ───────────────────────────────────────── */}
      <header className="flex items-baseline justify-between gap-3 flex-wrap pb-3 border-b-2 border-ink">
        <div className="flex items-baseline gap-3 flex-wrap">
          <p className="t-label-accent">도메인 코치</p>
          <p className="t-label">AI 진단·SMART 액션 제안</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`t-label-ink px-2 py-0.5 border-2 ${
              agent.severity >= 4
                ? "bg-signal-red !text-paper border-signal-red"
                : agent.severity >= 3
                  ? "bg-amber !text-paper border-amber"
                  : "bg-green !text-paper border-green"
            }`}
          >
            SEVERITY {agent.severity}
          </span>
          {agent.confidence !== null ? (
            <span className="t-label-ink px-2 py-0.5 border-2 border-ink">
              CONF {Math.round(agent.confidence * 100)}%
            </span>
          ) : null}
        </div>
      </header>

      {/* ── Finding (hero) ───────────────────────────────── */}
      {agent.finding ? (
        <div className="mt-5 border-l-[6px] border-ink pl-5 py-1">
          <p className="t-label mb-2">진단 요약</p>
          <p className="t-lede font-display">{agent.finding}</p>
        </div>
      ) : null}

      {/* ── A. Evidence ──────────────────────────────────── */}
      {agent.evidence.length > 0 ? (
        <CoachSection label={`근거 ${agent.evidence.length}`} index="A">
          <ul className="space-y-2.5 mt-2">
            {agent.evidence.map((e, i) => {
              const kindKo = evidenceKindLabel(e.kind);
              const kindBg =
                e.kind.toLowerCase() === "rag"
                  ? "bg-ink"
                  : e.kind.toLowerCase() === "kpi"
                    ? "bg-green"
                    : "bg-gold";
              return (
                <li
                  key={i}
                  className="grid grid-cols-[4.5rem_minmax(120px,auto)_1fr] gap-3 items-baseline"
                >
                  <span
                    className={`t-label-ink !text-paper px-2 py-0.5 text-center ${kindBg}`}
                    title={`출처 종류: ${kindKo}`}
                  >
                    {kindKo}
                  </span>
                  <span className="t-label text-ink truncate" title={e.source_id}>
                    {humanizeSourceId(e.source_id)}
                  </span>
                  <span className="t-body-sm text-ink/90">
                    {humanizeEvidenceSummary(e.summary)}
                  </span>
                </li>
              );
            })}
          </ul>
        </CoachSection>
      ) : null}

      {/* ── B. Next step ─────────────────────────────────── */}
      {agent.next_step ? (
        <CoachSection
          label={`다음 단계 · ${agent.next_step.kind.replace(/_/g, " ")}`}
          index="B"
        >
          <p className="t-display-4 text-ink mt-2">
            {agent.next_step.prompt}
          </p>
        </CoachSection>
      ) : null}

      {/* ── C. SMART action plan ─────────────────────────── */}
      {agent.smart_actions.length > 0 ? (
        <CoachSection
          label={`SMART 액션 플랜 ${agent.smart_actions.length}`}
          index="C"
        >
          <ol className="space-y-4 mt-3">
            {agent.smart_actions.map((a, i) => {
              const accepted = acceptedTitles.has(a.action);
              return (
                <li
                  key={i}
                  className={`grid grid-cols-[3rem_1fr] gap-4 border-2 px-4 py-3 transition-colors ${
                    accepted
                      ? "border-green bg-soft-green/30"
                      : "border-ink-soft/40 bg-paper-deep"
                  }`}
                >
                  <div className="text-right">
                    <p className="t-display-1 text-ink leading-none">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                  </div>
                  <div className="border-l-2 border-ink-soft/30 pl-4">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="t-label">담당</span>
                      <span className="t-body-sm font-semibold text-ink">
                        {a.owner}
                      </span>
                      <span className="t-label text-ink-soft/40">·</span>
                      <span className="t-label">기한</span>
                      <span className="t-body-sm font-semibold text-ink t-num">
                        {a.deadline_days}일
                      </span>
                    </div>
                    <p className="mt-2 t-display-4 text-ink">{a.action}</p>
                    {a.verification_metric ? (
                      <p className="mt-2 t-body-sm">
                        <span className="t-label mr-1.5 align-middle">검증</span>
                        <span className="text-ink/85">
                          {a.verification_metric}
                        </span>
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onAcceptAction(a, i)}
                      disabled={accepted || accepting}
                      className={`mt-3 px-4 py-1.5 t-label-ink transition-colors ${
                        accepted
                          ? "bg-green !text-paper border-2 border-green cursor-default"
                          : "bg-paper border-2 border-ink hover:bg-ink hover:!text-paper disabled:opacity-50"
                      }`}
                    >
                      {accepted ? "채택됨" : "채택하기"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </CoachSection>
      ) : null}

      <p className="mt-5 t-label pt-3 border-t border-ink-soft/30">
        {formatTime(message.created_at)}
      </p>
    </article>
  );
}

function CoachSection({
  label,
  index,
  children,
}: {
  label: string;
  index: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline gap-3 mb-3 pb-2 border-b-2 border-ink">
        <span className="t-display-2 text-accent leading-none">{index}</span>
        <h4 className="t-label-ink">{label}</h4>
      </div>
      {children}
    </section>
  );
}

function ExternalExpertBlock({ message }: { message: MessageRow }) {
  const c = message.content as ExpertContent;
  return (
    <article className="border-2 border-cobalt bg-soft-cobalt/40 p-6 sm:p-7">
      <header className="flex items-baseline justify-between gap-3 flex-wrap pb-3 border-b-2 border-cobalt">
        <div>
          <p
            className="t-label-ink"
            style={{ color: "var(--cobalt)" }}
          >
            외부 전문가 · {c.provider ?? "—"}
          </p>
          <p className="t-label mt-1">
            도메인 {c.domain ?? "—"}
            {typeof c.confidence === "number"
              ? ` · 신뢰도 ${Math.round(c.confidence * 100)}%`
              : ""}
            {typeof c.cost_krw === "number"
              ? ` · ₩${c.cost_krw.toLocaleString()}`
              : ""}
          </p>
        </div>
        {c._note ? (
          <span
            className="t-label-ink px-2 py-0.5 border-2"
            style={{
              borderColor: "var(--cobalt)",
              color: "var(--cobalt)",
            }}
          >
            {c.provider === "mock_expert" ? "MOCK" : "VERIFIED"}
          </span>
        ) : null}
      </header>

      {c.expert_finding ? (
        <div className="mt-5 border-l-[6px] pl-5 py-1" style={{ borderColor: "var(--cobalt)" }}>
          <p className="t-label mb-2">전문가 의견</p>
          <p className="t-lede font-display">{c.expert_finding}</p>
        </div>
      ) : null}

      {c.citations && c.citations.length > 0 ? (
        <CoachSection
          label={`참고 출처 ${c.citations.length}`}
          index="A"
        >
          <ul className="space-y-2.5 mt-2">
            {c.citations.map((cit, i) => (
              <li
                key={i}
                className="grid grid-cols-[4.5rem_minmax(120px,auto)_1fr] gap-3 items-baseline"
              >
                <span className="t-label-ink !text-paper bg-gold px-2 py-0.5 text-center">
                  {citationKindLabel(cit.kind)}
                </span>
                <span className="t-label text-ink truncate" title={cit.source_id}>
                  {humanizeSourceId(cit.source_id)}
                </span>
                <span className="t-body-sm text-ink/90">{cit.summary}</span>
              </li>
            ))}
          </ul>
        </CoachSection>
      ) : null}

      {c.recommended_actions && c.recommended_actions.length > 0 ? (
        <CoachSection
          label={`전문가 권고 ${c.recommended_actions.length}`}
          index="B"
        >
          <ol className="space-y-4 mt-3">
            {c.recommended_actions.map((a, i) => (
              <li
                key={i}
                className="grid grid-cols-[3rem_1fr] gap-4 border-2 border-ink-soft/40 bg-paper px-4 py-3"
              >
                <div className="text-right">
                  <p className="t-display-1 text-ink leading-none">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                </div>
                <div className="border-l-2 border-ink-soft/30 pl-4">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="t-label">담당</span>
                    <span className="t-body-sm font-semibold text-ink">
                      {a.owner_hint}
                    </span>
                    <span className="t-label text-ink-soft/40">·</span>
                    <span className="t-label">기한</span>
                    <span className="t-body-sm font-semibold text-ink t-num">
                      {a.deadline_days}일
                    </span>
                  </div>
                  <p className="mt-2 t-display-4 text-ink">{a.title}</p>
                  {a.risk_if_skipped ? (
                    <p className="mt-2 t-body-sm">
                      <span className="t-label-ink text-amber mr-1.5 align-middle">
                        주의
                      </span>
                      <span className="text-ink/85">{a.risk_if_skipped}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CoachSection>
      ) : null}

      {c.follow_up_questions && c.follow_up_questions.length > 0 ? (
        <CoachSection
          label={`후속 질문 ${c.follow_up_questions.length}`}
          index="C"
        >
          <ul className="space-y-2 mt-2">
            {c.follow_up_questions.map((q, i) => (
              <li
                key={i}
                className="grid grid-cols-[2.5rem_1fr] gap-3 t-body-sm"
              >
                <span className="t-label t-num">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-ink/90">{q}</span>
              </li>
            ))}
          </ul>
        </CoachSection>
      ) : null}

      <p className="mt-5 t-label pt-3 border-t" style={{ borderColor: "var(--cobalt)" }}>
        {formatTime(message.created_at)}
      </p>
    </article>
  );
}

function AcceptedAction({
  action,
  onChangeStatus,
}: {
  action: ActionRow;
  onChangeStatus: (id: string, status: string) => void;
}) {
  const deadline = action.deadline ? new Date(action.deadline) : null;
  const daysLeft = deadline
    ? Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  return (
    <article className="metric-card">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="kicker">{action.owner_role ?? "—"}</span>
        <span
          className={`tag ${
            action.status === "verified" || action.status === "completed"
              ? "tag-green"
              : action.status === "failed" || action.status === "abandoned"
                ? "tag-red"
                : "tag-filled"
          }`}
        >
          {action.status}
        </span>
      </header>
      <p className="mt-2 font-display text-base leading-tight">
        {action.title}
      </p>
      <div className="mt-2 flex items-center gap-2 flex-wrap label-mono">
        {deadline ? (
          <span>
            deadline · {deadline.toLocaleDateString("ko-KR")}
            {daysLeft !== null
              ? ` (${daysLeft >= 0 ? `D-${daysLeft}` : `D+${-daysLeft}`})`
              : ""}
          </span>
        ) : null}
        {action.verification_metric &&
        typeof action.verification_metric.description === "string" ? (
          <>
            <span>·</span>
            <span>{action.verification_metric.description as string}</span>
          </>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {["accepted", "in_progress", "completed", "verified", "abandoned"].map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChangeStatus(action.id, s)}
              disabled={action.status === s}
              className={`text-xs px-2 py-1 border transition ${
                action.status === s
                  ? "bg-ink text-paper border-ink cursor-default"
                  : "bg-paper border-ink-soft hover:border-ink"
              }`}
            >
              {s}
            </button>
          ),
        )}
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red";
}) {
  const color =
    tone === "green"
      ? "text-signal-green"
      : tone === "amber"
        ? "text-signal-amber"
        : tone === "red"
          ? "text-signal-red"
          : "text-ink";
  return (
    <div className="metric-card">
      <p className="label-mono">{label}</p>
      <p className={`num mt-1 ${color}`}>{value}</p>
      {sub ? <p className="mt-1 label-mono">{sub}</p> : null}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function tierColor(tier: Domain["tier"]): string {
  switch (tier) {
    case "critical":
      return "accent";
    case "important":
      return "gold";
    case "supporting":
      return "filled";
  }
}

function kindTag(kind: string): string {
  switch (kind) {
    case "kpi":
      return "tag-green";
    case "doc":
      return "tag-gold";
    case "rag":
      return "tag-filled";
    case "user_input":
      return "";
    default:
      return "";
  }
}

function parseAgentContent(content: Record<string, unknown>): AgentReply | null {
  if (!content || typeof content !== "object") return null;
  if (content.raw && !content.finding) return null;
  const finding = (content.finding ?? null) as string | null;
  const evidence = Array.isArray(content.evidence)
    ? (content.evidence as AgentEvidence[])
    : [];
  const severity = typeof content.severity === "number" ? content.severity : 3;
  const confidence =
    typeof content.confidence === "number" ? content.confidence : null;
  const next_step = (content.next_step as AgentNextStep | null) ?? null;
  const smart_actions = Array.isArray(content.smart_actions)
    ? (content.smart_actions as AgentSmartAction[])
    : [];
  return { finding, evidence, severity, confidence, next_step, smart_actions };
}

function extractLatestAgent(messages: MessageRow[]): AgentReply | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "agent") {
      const a = parseAgentContent(messages[i].content);
      if (a) return a;
    }
  }
  return null;
}

function formatTime(iso: string): string {
  // Deterministic format to avoid SSR/CSR locale mismatch
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// 평이한 한국어 라벨 변환 — 직원이 쉽게 이해할 수 있도록
// ============================================================

/**
 * 근거 종류(DOC/RAG/KPI/USER_INPUT)를 한국어 라벨로 변환.
 *  - DOC : 진단 응답 (사용자가 입력한 belief/evidence)
 *  - RAG : 참고 문헌 (Christensen, Mom Test 등)
 *  - KPI : 자동 수집된 KPI 수치
 *  - 기타: 그대로 대문자 표기
 */
function evidenceKindLabel(kind: string): string {
  const k = kind.toLowerCase();
  if (k === "doc") return "진단";
  if (k === "rag") return "문헌";
  if (k === "kpi") return "KPI";
  if (k === "user_input") return "답변";
  return kind.toUpperCase();
}

/**
 * 외부 전문가 citation 의 kind(law / guideline / benchmark)를 한국어로.
 */
function citationKindLabel(kind?: string): string {
  if (!kind) return "참고";
  const k = kind.toLowerCase();
  if (k === "law") return "법령";
  if (k === "guideline") return "가이드";
  if (k === "benchmark") return "벤치마크";
  return kind.toUpperCase();
}

/**
 * sub_item code 나 RAG source id 를 직원이 읽기 쉬운 형태로 변환.
 *  - "A1.JTBD.URGENCY" → "A1 · 긴급성"
 *  - "Christensen_Competing_Against_Luck_2016" → "Christensen — Competing Against Luck (2016)"
 *  - 알 수 없으면 그대로 반환
 */
const SUB_ITEM_KO: Record<string, string> = {
  "A1.JTBD.URGENCY": "A1 · 긴급성",
  "A1.JTBD.PUSH": "A1 · 구매 동기 (Push)",
  "A1.JTBD.LANG": "A1 · 고객 언어",
  "A2.SE.40": "A2 · Sean Ellis 40% 테스트",
  "A2.RET.M3": "A2 · 3개월 retention",
  "A3.BUYER.WTP": "A3 · 교사 활성 사용자",
  "A3.BUYER.ROI": "A3 · 교사 ROI 자료",
  "A4.ACT.D1": "A4 · D1 활성화율",
  "A7.KISA.SELFCHECK": "A7 · KISA 자기점검",
  "A7.PII.INCIDENT": "A7 · 개인정보 사고",
  "A11.FOUNDERS.ALIGN": "A11 · 리더십 정렬",
  "A11.RUN.STAY": "A11 · 핵심 인재 stay-intent",
  "A14.WIN.RATE": "A14 · 경쟁 win-rate",
};

function humanizeSourceId(id: string): string {
  if (SUB_ITEM_KO[id]) return SUB_ITEM_KO[id];
  // RAG 출처 패턴: "Christensen_Competing_Against_Luck_2016"
  if (/^[A-Z][a-zA-Z]+(_[A-Z][a-zA-Z]+)+_\d{4}$/.test(id)) {
    const parts = id.split("_");
    const year = parts[parts.length - 1];
    const author = parts[0];
    const title = parts.slice(1, -1).join(" ");
    return `${author} — ${title} (${year})`;
  }
  return id;
}

/**
 * 코치가 evidence summary 에 "belief=3·evidence=3·score=50 — …" 같은 raw 표현을
 * 그대로 넣은 경우 평이한 한국어로 풀어준다.
 */
function humanizeEvidenceSummary(text: string): string {
  if (!text) return text;
  // "belief=3·evidence=3·score=50 — " 같은 머리말 제거 후 본문만 표시.
  // belief 1–5 → 평가 5단계 라벨로 변환할 수도 있으나 가독성 위해 머리말 자체를 평이하게.
  return text.replace(
    /^belief=(\d)[\s·]+evidence=([\dN/A]+)[\s·]+score=([\d\-—]+)\s*—?\s*/,
    (_m, b, e, s) => {
      const beliefMap: Record<string, string> = {
        "1": "측정 안 함",
        "2": "낮음",
        "3": "중간",
        "4": "높음",
        "5": "매우 높음",
      };
      const evidenceMap: Record<string, string> = {
        "1": "측정 안 함",
        "2": "초기 신호",
        "3": "중간 수준",
        "4": "양호",
        "5": "강한 증거",
        "N/A": "해당 없음",
      };
      const beliefLabel = beliefMap[b] ?? `level ${b}`;
      const evidenceLabel = evidenceMap[e] ?? `level ${e}`;
      const scoreNum = s === "—" || s === "-" ? "—" : `${s}점`;
      return `자가평가 ${beliefLabel} · 증거 ${evidenceLabel} · 점수 ${scoreNum} — `;
    },
  );
}

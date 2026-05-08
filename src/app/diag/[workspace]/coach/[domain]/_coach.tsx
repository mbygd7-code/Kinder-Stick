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
            <a href={`/diag/${workspace}/dashboard`} className="kicker hover:text-ink">
              ← Dashboard
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
      <article className="ml-auto max-w-[85%] area-card !bg-paper-deep border-ink-soft">
        <p className="kicker mb-2">YOU</p>
        <p className="whitespace-pre-wrap">{text}</p>
        <p className="mt-2 label-mono">
          {formatTime(message.created_at)}
        </p>
      </article>
    );
  }

  // agent
  const agent = parseAgentContent(message.content);
  if (!agent) {
    return (
      <article className="area-card">
        <p className="kicker !text-signal-red">Agent (parse failed)</p>
        <pre className="mt-2 font-mono text-xs whitespace-pre-wrap">
          {message.content?.raw
            ? String(message.content.raw)
            : JSON.stringify(message.content, null, 2)}
        </pre>
      </article>
    );
  }

  return (
    <article className="area-card">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="kicker">DOMAIN COACH</p>
        <div className="flex items-center gap-2">
          <span
            className={`tag ${agent.severity >= 4 ? "tag-red" : agent.severity >= 3 ? "tag-gold" : "tag-green"}`}
          >
            severity {agent.severity}
          </span>
          {agent.confidence !== null ? (
            <span className="tag">
              conf {Math.round(agent.confidence * 100)}%
            </span>
          ) : null}
        </div>
      </header>

      {agent.finding ? (
        <h3 className="mt-3 font-display text-2xl leading-tight">
          {agent.finding}
        </h3>
      ) : null}

      {agent.evidence.length > 0 ? (
        <div className="mt-4 dotted-rule pt-3">
          <p className="label-mono mb-2">Evidence cited</p>
          <ul className="space-y-2">
            {agent.evidence.map((e, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className={`tag ${kindTag(e.kind)}`}>
                  {e.kind.toUpperCase()}
                </span>
                <span className="font-mono text-xs text-ink-soft min-w-[80px]">
                  {e.source_id}
                </span>
                <span>{e.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {agent.next_step ? (
        <div className="mt-4 dotted-rule pt-3">
          <p className="kicker mb-1">Next step · {agent.next_step.kind}</p>
          <p className="font-display text-lg leading-snug">
            {agent.next_step.prompt}
          </p>
        </div>
      ) : null}

      {agent.smart_actions.length > 0 ? (
        <div className="mt-5 dotted-rule pt-3">
          <p className="kicker mb-3">SMART action plan</p>
          <ul className="space-y-3">
            {agent.smart_actions.map((a, i) => {
              const accepted = acceptedTitles.has(a.action);
              return (
                <li
                  key={i}
                  className="border border-ink-soft p-3 bg-paper-soft flex flex-col gap-2"
                >
                  <header className="flex items-baseline justify-between gap-3">
                    <span className="kicker">
                      <span className="section-num">No. </span>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="tag tag-filled">
                      {a.owner} · {a.deadline_days}d
                    </span>
                  </header>
                  <p className="font-display text-base leading-snug">
                    {a.action}
                  </p>
                  {a.verification_metric ? (
                    <p className="label-mono">
                      검증 — {a.verification_metric}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onAcceptAction(a, i)}
                    disabled={accepted || accepting}
                    className={`self-start text-xs px-3 py-1.5 border-2 transition ${
                      accepted
                        ? "bg-signal-green text-paper border-signal-green cursor-default"
                        : "bg-paper border-ink hover:bg-ink hover:text-paper"
                    }`}
                  >
                    {accepted ? "✓ 채택됨" : "채택하기"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 label-mono">
        {formatTime(message.created_at)}
      </p>
    </article>
  );
}

function ExternalExpertBlock({ message }: { message: MessageRow }) {
  const c = message.content as ExpertContent;
  return (
    <article
      className="area-card !border-cobalt bg-soft-cobalt/40"
    >
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="kicker" style={{ color: "var(--cobalt)" }}>
            EXTERNAL EXPERT · {c.provider ?? "—"}
          </p>
          <p className="label-mono mt-0.5">
            domain: {c.domain ?? "—"}
            {typeof c.confidence === "number"
              ? ` · confidence ${Math.round(c.confidence * 100)}%`
              : ""}
            {typeof c.cost_krw === "number"
              ? ` · ₩${c.cost_krw.toLocaleString()}`
              : ""}
          </p>
        </div>
        {c._note ? (
          <span className="tag" style={{ borderColor: "var(--cobalt)", color: "var(--cobalt)" }}>
            {c.provider === "mock_expert" ? "MOCK" : "VERIFIED"}
          </span>
        ) : null}
      </header>

      {c.expert_finding ? (
        <h3 className="mt-3 font-display text-2xl leading-tight">
          {c.expert_finding}
        </h3>
      ) : null}

      {c.citations && c.citations.length > 0 ? (
        <div className="mt-4 dotted-rule pt-3">
          <p className="label-mono mb-2">Citations</p>
          <ul className="space-y-2">
            {c.citations.map((cit, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className="tag tag-gold">{cit.kind?.toUpperCase()}</span>
                <span className="font-mono text-xs text-ink-soft">
                  {cit.source_id}
                </span>
                <span>{cit.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.recommended_actions && c.recommended_actions.length > 0 ? (
        <div className="mt-4 dotted-rule pt-3">
          <p className="kicker mb-2">Expert recommendations</p>
          <ul className="space-y-3">
            {c.recommended_actions.map((a, i) => (
              <li
                key={i}
                className="border border-ink-soft p-3 bg-paper-soft"
              >
                <header className="flex items-baseline justify-between gap-3">
                  <span className="kicker">
                    <span className="section-num">No. </span>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="tag tag-filled">
                    {a.owner_hint} · {a.deadline_days}d
                  </span>
                </header>
                <p className="mt-2 font-display text-base leading-snug">
                  {a.title}
                </p>
                {a.risk_if_skipped ? (
                  <p className="mt-2 label-mono">
                    skipping risk — {a.risk_if_skipped}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.follow_up_questions && c.follow_up_questions.length > 0 ? (
        <div className="mt-4 dotted-rule pt-3">
          <p className="kicker mb-2">Follow-up questions</p>
          <ul className="space-y-1.5 text-sm">
            {c.follow_up_questions.map((q, i) => (
              <li key={i}>· {q}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 label-mono">
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

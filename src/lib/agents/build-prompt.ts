/**
 * System prompt builder for 14 domain coaches.
 *
 * Reads framework/agent_prompts/_base.md (shared template) +
 * framework/agent_prompts/domain_coaches.md (per-domain specialization),
 * fills in {{...}} placeholders, and appends retrieved context.
 *
 * Server-side only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import type { Domain } from "@/lib/framework/loader";

const FRAMEWORK_DIR = (() => {
  const inRepo = join(process.cwd(), "framework");
  const parent = join(process.cwd(), "..", "framework");
  try {
    require("node:fs").statSync(join(inRepo, "agent_prompts", "_base.md"));
    return inRepo;
  } catch {
    return parent;
  }
})();
const BASE_PATH = join(FRAMEWORK_DIR, "agent_prompts", "_base.md");
const DOMAIN_PATH = join(FRAMEWORK_DIR, "agent_prompts", "domain_coaches.md");

// ============================================================
// File loaders (cached per request)
// ============================================================

const loadBase = cache((): string => {
  const raw = readFileSync(BASE_PATH, "utf-8");
  // Extract content inside the ``` code fence (the template body)
  const match = raw.match(/```\s*\n([\s\S]*?)\n```/);
  return match ? match[1] : raw;
});

const loadDomainCoaches = cache((): string =>
  readFileSync(DOMAIN_PATH, "utf-8"),
);

/**
 * domain_coaches.md에서 한 도메인의 specialization 섹션을 추출한다.
 * "## A2 — PMF Coach" ~ 다음 "## " 또는 EOF 사이.
 */
export const extractDomainSection = cache((domainCode: string): string => {
  const text = loadDomainCoaches();
  const re = new RegExp(
    `^##\\s+${domainCode}\\s+[—–-].*?$([\\s\\S]*?)(?=^##\\s+[A-Z]\\d|\\z)`,
    "m",
  );
  const m = text.match(re);
  return m ? m[1].trim() : "";
});

// ============================================================
// Types
// ============================================================

export interface OrgContext {
  workspace_id: string;
  stage: string;
  team_size?: string;
}

export interface RetrievedKpi {
  metric_key: string;
  value: number | string;
  captured_at: string;
}

export interface RetrievedEvidence {
  sub_item_code: string;
  belief?: number;
  evidence?: number | null;
  na?: boolean;
  score?: number | null;
  citation?: string;
}

export interface PlaybookSummary {
  id: string;
  title: string;
  diagnostic_q: string;
  smart_actions: Array<{
    owner: string;
    deadline_days: number;
    action: string;
  }>;
  verify: { metric: string; after_days: number };
  cite: string;
}

export interface RetrievedAction {
  id: string;
  title: string;
  owner_role: string | null;
  deadline: string | null;
  status: string;
  domain_code: string | null;
  days_left: number | null;
  is_overdue: boolean;
  verification_metric: string | null;
}

export interface RetrievedTimelineQuarter {
  quarter_label: string;
  bucket_start: string;
  bucket_end: string;
  n_respondents: number;
  overall_score: number | null;
  domain_scores: Array<{
    code: string;
    score: number | null;
    tier_label: "red" | "yellow" | "green";
  }>;
  fp_6m: number;
  fp_12m: number;
  red_critical_codes: string[];
}

export interface BuildPromptArgs {
  domain: Domain;
  org: OrgContext;
  retrieved_kpi: RetrievedKpi[];
  retrieved_evidence: RetrievedEvidence[];
  matched_playbooks: PlaybookSummary[];
  retrieved_actions?: RetrievedAction[];
  retrieved_timeline?: RetrievedTimelineQuarter[];
}

// ============================================================
// Builder
// ============================================================

export function buildSystemPrompt(args: BuildPromptArgs): string {
  const { domain, org, retrieved_kpi, retrieved_evidence, matched_playbooks } =
    args;

  const baseTemplate = loadBase();
  const domainSection = extractDomainSection(domain.code);

  // Extract specialization paragraph + RAG corpus + 1-shot from the markdown section
  const specialization = domainSection
    .replace(/^###\s+.+$/gm, (h) => `\n[${h.replace(/^###\s+/, "")}]`)
    .replace(/^>\s+/gm, "")
    .trim();

  const externalHandoffNote =
    /외부 핸드오프 가능|외부 핸드오프/.test(domainSection)
      ? `이 도메인은 외부 AI 자문(법무·세무 등) 핸드오프가 가능합니다. severity≥4이고 내부 confidence<0.7이면 next_step.kind = "external_handoff"로 제안하세요. (Phase 4에서 실제 호출 wiring)`
      : `이 도메인은 외부 핸드오프 없이 내부 처리만 합니다.`;

  // Fill placeholders
  const filled = baseTemplate
    .replace(/{{도메인 이름}}/g, `${domain.code} ${domain.name_ko}`)
    .replace(/{{전문 분야 한 문장}}/g, domain.framework)
    .replace(/{{도메인 코드}}/g, domain.code)
    .replace(/{{회사명}}/g, org.workspace_id)
    .replace(/{{stage}}/g, org.stage)
    .replace(/{{외부 핸드오프 가능 여부 — A7\/A12 등에만}}/g, externalHandoffNote)
    .replace(/{{외부 핸드오프 가능 여부.*?}}/g, externalHandoffNote)
    .replace(
      /{{retrieved_kpi}}/g,
      formatKpi(retrieved_kpi),
    )
    .replace(
      /{{retrieved_evidence}}/g,
      formatEvidence(retrieved_evidence),
    )
    .replace(
      /{{retrieved_playbook}}/g,
      formatPlaybooks(matched_playbooks),
    )
    .replace(
      /{{retrieved_timeline}}/g,
      formatTimeline(args.retrieved_timeline ?? [], domain.code),
    )
    .replace(
      /{{retrieved_actions}}/g,
      formatActions(args.retrieved_actions ?? []),
    );

  return [
    filled,
    "",
    "----- DOMAIN SPECIALIZATION -----",
    specialization,
    "",
    "----- IMPORTANT: 응답은 반드시 다음 JSON 객체만 포함한 메시지로 출력 -----",
    `{
  "finding": "한 문장 요약",
  "evidence": [{"kind":"kpi|doc|rag|user_input","source_id":"...","summary":"..."}],
  "severity": 1,
  "next_step": {"kind":"diagnostic_question|evidence_request|action_proposal|external_handoff|resolved","prompt":"..."},
  "confidence": 0.85,
  "smart_actions": [{"owner":"PM","deadline_days":14,"action":"...","verification_metric":"..."}],
  "action_verifications": [{"action_id":"<retrieved_actions의 8자 prefix>","new_status":"verified|completed|failed|abandoned","measurement":"<객관 결과>","rationale":"<1문장>"}]
}`,
    "JSON 외 다른 텍스트(설명, 백틱 등) 절대 출력 금지. evidence[]가 비어있으면 안 됨 — 최소 user_input 1건은 포함. action_verifications 는 사용자가 액션 진행을 보고했을 때만 채우고, 그 외에는 빈 배열 또는 생략.",
    "",
    "최신 액션 상태는 system 프롬프트 끝의 <live_action_state> 블록을 참조하세요.",
  ].join("\n");
}

// ============================================================
// Cache-aware split builder
// ============================================================

export interface SystemPromptParts {
  /** Stable across turns — eligible for prompt cache (cache_control: ephemeral) */
  cacheable: string;
  /** Changes each turn (live action state) — appended without caching */
  dynamic: string;
}

/**
 * Build a system prompt that splits the static portion (cacheable) from the
 * dynamic action-state portion (recomputed each turn). Same final content as
 * buildSystemPrompt() but ready for Anthropic prompt caching.
 */
export function buildSystemPromptParts(
  args: BuildPromptArgs,
): SystemPromptParts {
  // The static portion: build via buildSystemPrompt with empty action list.
  // Since _base.md no longer references {{retrieved_actions}}, the function
  // ignores retrieved_actions for the textual body — it only matters for the
  // dynamic suffix below.
  const staticArgs: BuildPromptArgs = { ...args, retrieved_actions: [] };
  const cacheable = buildSystemPrompt(staticArgs);

  const actions = args.retrieved_actions ?? [];
  const dynamic = [
    "<live_action_state>",
    "(이 블록은 매 턴 재계산되어 system 프롬프트 끝에 주입됩니다.",
    " 이 블록의 정보가 retrieved_context 내 다른 정보보다 우선합니다.)",
    "",
    formatActions(actions),
    "</live_action_state>",
  ].join("\n");

  return { cacheable, dynamic };
}

// ============================================================
// User message builder (initial diagnostic)
// ============================================================

export function buildInitialUserMessage(args: {
  domain: Domain;
  domain_score: number | null;
  red_critical: boolean;
  retrieved_evidence: RetrievedEvidence[];
}): string {
  const { domain, domain_score, red_critical, retrieved_evidence } = args;
  const lines: string[] = [];
  lines.push(`도메인 진단을 시작합니다: ${domain.code} ${domain.name_ko}`);
  lines.push("");
  lines.push("[현재 점수]");
  lines.push(
    `- 도메인 점수: ${domain_score === null ? "데이터 부족" : domain_score.toFixed(1)} / 100`,
  );
  lines.push(`- threshold: red ${domain.thresholds.red} · yellow ${domain.thresholds.yellow} · green ${domain.thresholds.green}`);
  lines.push(
    `- critical 빨강: ${red_critical ? "예 (즉시 조치 필요)" : "아니오"}`,
  );

  lines.push("");
  lines.push("[Sub-item 응답 요약]");
  if (retrieved_evidence.length === 0) {
    lines.push("- 응답 없음. 데이터 수집부터 제안하세요.");
  } else {
    for (const e of retrieved_evidence) {
      const score =
        e.score === null || e.score === undefined ? "—" : e.score.toFixed(0);
      lines.push(
        `- ${e.sub_item_code}: belief=${e.belief ?? "?"} evidence=${
          e.na ? "N/A" : (e.evidence ?? "?")
        } → score=${score}`,
      );
    }
  }

  lines.push("");
  lines.push(
    "이 도메인의 가장 큰 위험 신호 1개를 식별하고, 진단 질문 1개와 SMART 3단계 액션을 제안하세요.",
  );
  lines.push(
    "JSON 형식만 출력하세요. evidence[]에는 위 sub-item 응답에서 인용해야 합니다.",
  );

  return lines.join("\n");
}

// ============================================================
// Helpers
// ============================================================

function formatKpi(kpi: RetrievedKpi[]): string {
  if (kpi.length === 0) return "(연동된 KPI 없음 — Phase 3에서 wiring 예정)";
  return kpi
    .map(
      (k) =>
        `- ${k.metric_key} = ${k.value} (captured ${k.captured_at})`,
    )
    .join("\n");
}

function formatEvidence(ev: RetrievedEvidence[]): string {
  if (ev.length === 0) return "(증거 없음)";
  return ev
    .map(
      (e) =>
        `- ${e.sub_item_code}: belief=${e.belief ?? "?"} evidence=${
          e.na ? "N/A" : (e.evidence ?? "?")
        } score=${
          e.score === null || e.score === undefined ? "—" : e.score.toFixed(0)
        }${e.citation ? ` [cite: ${e.citation}]` : ""}`,
    )
    .join("\n");
}

function formatPlaybooks(pb: PlaybookSummary[]): string {
  if (pb.length === 0) return "(매칭된 playbook 없음)";
  return pb
    .map(
      (p) =>
        `[${p.id}] ${p.title}\n  진단 Q: ${p.diagnostic_q}\n  SMART: ${p.smart_actions
          .map((a) => `${a.owner} (${a.deadline_days}d) ${a.action}`)
          .join(" / ")}\n  검증: ${p.verify.metric} (after ${p.verify.after_days}d)\n  인용: ${p.cite}`,
    )
    .join("\n\n");
}

export function formatTimeline(
  quarters: RetrievedTimelineQuarter[],
  domainCode: string,
): string {
  if (quarters.length === 0) {
    return "(과거 분기 진단 기록 없음 — 첫 진단)";
  }
  if (quarters.length === 1) {
    const q = quarters[0];
    const dom = q.domain_scores.find((d) => d.code === domainCode);
    return [
      `[현재 분기 1건만 — 추세 미산출]`,
      `${q.quarter_label}: overall ${
        q.overall_score === null ? "—" : Math.round(q.overall_score)
      } · P(6m) ${Math.round(q.fp_6m * 100)}% · n=${q.n_respondents}`,
      domainCode && dom
        ? `이 도메인 ${domainCode}: ${dom.score === null ? "—" : Math.round(dom.score)} (${dom.tier_label})`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const latest = quarters[quarters.length - 1];
  const prev = quarters[quarters.length - 2];

  const lines: string[] = [];
  lines.push(`[과거 ${quarters.length}분기 진단 기록]`);
  for (const q of quarters) {
    const dom = q.domain_scores.find((d) => d.code === domainCode);
    const domStr = dom
      ? `${dom.score === null ? "—" : Math.round(dom.score)}(${dom.tier_label[0]})`
      : "—";
    const redStr =
      q.red_critical_codes.length > 0
        ? ` red:[${q.red_critical_codes.join(",")}]`
        : "";
    lines.push(
      `- ${q.quarter_label}: overall ${
        q.overall_score === null ? "—" : Math.round(q.overall_score)
      } · ${domainCode}=${domStr} · P(6m) ${Math.round(q.fp_6m * 100)}% · n=${q.n_respondents}${redStr}`,
    );
  }

  // Delta vs previous quarter (this domain + overall)
  const latestDom = latest.domain_scores.find((d) => d.code === domainCode);
  const prevDom = prev.domain_scores.find((d) => d.code === domainCode);
  if (
    latestDom?.score !== null &&
    latestDom?.score !== undefined &&
    prevDom?.score !== null &&
    prevDom?.score !== undefined
  ) {
    const delta = latestDom.score - prevDom.score;
    let interp = "";
    if (delta >= 10) interp = " — 큰 개선. 무엇이 작동했는지 사용자에게 확인하세요.";
    else if (delta <= -10) interp = " — 큰 회귀. 원인 파악이 우선.";
    else if (Math.abs(delta) < 3) interp = " — 거의 정체. 같은 처방 반복하지 말 것.";
    lines.push(
      `\nΔ ${domainCode} ${prev.quarter_label}→${latest.quarter_label}: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt${interp}`,
    );
  }
  if (latest.overall_score !== null && prev.overall_score !== null) {
    const delta = latest.overall_score - prev.overall_score;
    lines.push(
      `Δ overall ${prev.quarter_label}→${latest.quarter_label}: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt`,
    );
  }
  // Red critical history hint
  const everRed = new Set<string>();
  for (const q of quarters) for (const c of q.red_critical_codes) everRed.add(c);
  if (everRed.size > 0) {
    lines.push(`최근 ${quarters.length}분기 동안 red critical 도메인: ${Array.from(everRed).join(", ")}`);
  }
  return lines.join("\n");
}

export function formatActions(actions: RetrievedAction[]): string {
  if (actions.length === 0) {
    return "(이 워크스페이스에서 채택된 액션 없음 — 첫 코칭 세션)";
  }
  // Group by status; surface overdue first
  const overdue = actions.filter((a) => a.is_overdue);
  const active = actions.filter(
    (a) => !a.is_overdue && (a.status === "accepted" || a.status === "in_progress"),
  );
  const done = actions.filter(
    (a) =>
      a.status === "completed" ||
      a.status === "verified" ||
      a.status === "abandoned",
  );

  const lines: string[] = [];
  lines.push(
    `[채택된 액션 총 ${actions.length}건 — 사용자가 follow-up 받기를 기대합니다]`,
  );
  if (overdue.length > 0) {
    lines.push(`\n⚠ OVERDUE (${overdue.length}건) — 진단 전에 진행 상황을 먼저 물으세요:`);
    for (const a of overdue) {
      lines.push(`  - #${a.id.slice(0, 8)} [${a.domain_code ?? "?"} · ${a.owner_role ?? "?"}] "${a.title.slice(0, 100)}" — ${a.days_left ?? "?"}d (status=${a.status}, deadline ${a.deadline ?? "?"})`);
    }
  }
  if (active.length > 0) {
    lines.push(`\nACTIVE (${active.length}건):`);
    for (const a of active) {
      lines.push(`  - #${a.id.slice(0, 8)} [${a.domain_code ?? "?"} · ${a.owner_role ?? "?"}] "${a.title.slice(0, 100)}" — ${a.days_left !== null ? `D-${a.days_left}` : "no deadline"} (status=${a.status})`);
    }
  }
  if (done.length > 0) {
    lines.push(`\n완료/포기 (${done.length}건):`);
    for (const a of done) {
      lines.push(`  - #${a.id.slice(0, 8)} [${a.domain_code ?? "?"}] ${a.status} — "${a.title.slice(0, 80)}"`);
    }
  }
  return lines.join("\n");
}

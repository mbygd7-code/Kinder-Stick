/**
 * Worklist Deriver — 외부 데이터 텍스트 → (overrides, derived tasks).
 *
 * 한국 EdTech 운영진을 돕는 어시스턴트. 주간/월간 분석 텍스트가 들어오면
 *  (a) 기존 워크리스트 134개 중 격상해야 할 task의 task_id + 새 cadence/tier
 *  (b) catalog에 없는 신규 task (DerivedTask 스키마)
 * 둘을 JSON으로 반환한다.
 *
 * 환각 방지:
 *  - 기존 task의 (id, team, phase, title, funnel_stage) 슬림 목록을 시스템 프롬프트
 *    에 주입. 매칭 우선.
 *  - team / phase / funnel_stage 모두 enum 값만 허용.
 *  - 응답 검증은 flatMap + 타입 가드 (external-experts.ts 패턴).
 */

import { anthropic } from "@/lib/anthropic";
import {
  TASKS,
  TEAM_ORDER,
  PHASE_ORDER,
  FUNNEL_ORDER,
  getFunnelStage,
  type DerivedTask,
  type TaskOverride,
  type Team,
  type Phase,
  type FunnelStage,
  type Cadence,
  type Tier,
} from "@/lib/worklist/catalog";

const CADENCE_ENUM: Cadence[] = [
  "once",
  "weekly",
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
  "as_needed",
];
const TIER_ENUM: Tier[] = ["must", "conditional", "recurring"];

export interface DeriveInput {
  text: string;
  source: string;
  period: "weekly" | "monthly" | "quarterly";
  workspace: string;
}

export interface DeriveOutput {
  overrides: TaskOverride[];
  derived: DerivedTask[];
  summary: string;
  model: string;
  raw_preview?: string;
}

interface AiResponse {
  overrides?: unknown[];
  derived?: unknown[];
  summary?: unknown;
}

function buildBaseTaskList(): string {
  // 134개 task의 슬림 목록 — 시스템 프롬프트 컨텍스트로 주입.
  return TASKS.map((t) => {
    const stage = getFunnelStage(t);
    return `${t.id} | ${t.team} | ${t.phase} | ${stage} | ${t.title}`;
  }).join("\n");
}

function buildSystemPrompt(): string {
  const baseList = buildBaseTaskList();
  return [
    "당신은 한국 EdTech 운영진을 돕는 마케팅 퍼널 분석가 + 워크리스트 매니저입니다.",
    "주간/월간 데이터 분석 텍스트가 들어오면 세 가지를 결정합니다:",
    "  (a) **마케팅 퍼널 7단계** (인지→획득→활성화→유지→매출→추천→확장) 관점에서 어디에서 무슨 일이 벌어지고 있는지를 평이한 한국어로 설명 (summary).",
    "  (b) 기존 워크리스트의 어떤 task를 격상/가속해야 하는지 (overrides)",
    "  (c) catalog에 없는, 신규로 추가해야 할 task (derived)",
    "",
    "## summary 작성 규칙 — 가장 중요",
    "summary는 직원이 보고서로 그대로 출력해도 될 정도로 **구조화된 마크다운**으로 작성합니다.",
    "다음 형식을 그대로 따르세요:",
    "",
    "```",
    "## 마케팅 퍼널 진단 — <소스명, 기간>",
    "",
    "### 🎯 인지 (Awareness)",
    "- 신호: <텍스트의 채널 점유율·노출량·브랜드 검색 수치 인용>",
    "- 시사점: <2-3 문장으로 이 단계에서 무엇이 일어났고 왜 중요한지>",
    "- 실무 가이드: <이번 주 누가 무엇을 해야 하는지 1-2개>",
    "",
    "### 🚪 획득 (Acquisition)",
    "- 신호: <신규 가입·CAC·랜딩 전환 수치>",
    "- 시사점: ...",
    "- 실무 가이드: ...",
    "",
    "### ⚡ 활성화 (Activation)",
    "- 신호: <D1·온보딩 완료율·첫 행동 수치>",
    "- 시사점: ...",
    "- 실무 가이드: ...",
    "",
    "### 🔁 유지 (Retention)",
    "- 신호: <WAU/MAU·M1·M3 코호트·재방문>",
    "- 시사점: ...",
    "- 실무 가이드: ...",
    "",
    "### 💰 매출 (Revenue)",
    "- 신호: <유료 전환·결제·ARPU·CAC payback>",
    "- 시사점: ...",
    "- 실무 가이드: ...",
    "",
    "### 📣 추천 (Referral)",
    "- 신호: <NPS·referral·입소문 수치>",
    "- 시사점: ...",
    "- 실무 가이드: ...",
    "",
    "### 🌱 확장 (Expansion)",
    "- 신호: <NRR·upsell·PLC 그룹 확장>",
    "- 시사점: ...",
    "- 실무 가이드: ...",
    "",
    "### 🧭 종합 진단 + 다음 7일 우선순위",
    "1. [퍼널단계] 가장 위험한 한 가지 — 누가·언제·무엇을",
    "2. [퍼널단계] 두번째 우선 — 누가·언제·무엇을",
    "3. [퍼널단계] 세번째 우선 — 누가·언제·무엇을",
    "```",
    "",
    "## summary 작성 추가 규칙",
    "- **데이터에 단서가 없는 단계는 \"신호: (데이터 없음)\" 으로 표기하고 해석을 만들지 마세요.** 텍스트에 없는 숫자/추론 금지.",
    "- 수치는 반드시 원문에서 인용 — 변동률(%), 절대값(WAU 2,290 등)을 명시.",
    "- 평이한 한국어로. 영어 약어(WAU/DAU/CAC 등)는 처음 등장 시 괄호로 풀어주세요.",
    "- 실무 가이드는 \"누가(팀명) · 언제(이번주/2주내/이번달) · 무엇을(구체 동사)\" 3요소 모두 포함.",
    "- 종합 진단의 우선순위 3개는 perspective가 서로 다른 퍼널 단계에서 뽑아 균형을 맞추세요.",
    "",
    "## overrides / derived 작성 규칙",
    "- 기존 task 목록을 먼저 검토. 데이터와 매칭되는 task가 있으면 **무조건 override 우선**.",
    "- 매칭이 약하면 derived task를 신규 생성. 단 catalog의 team/phase/funnel_stage enum만 사용.",
    "- 한 응답에서 derived는 최대 5개, overrides는 최대 8개.",
    "- confidence < 0.6은 사용자가 거를 수 있게 낮은 값으로 표시.",
    "- 추측 금지: 텍스트에 없는 숫자/사실을 만들지 마세요.",
    "- override.task_id는 반드시 아래 목록에 있는 id 중 하나.",
    "- derived.id는 'derived-<slug>' 형식 (한글/공백 금지, 영문/숫자/하이픈).",
    "- derived와 overrides가 summary의 \"실무 가이드\" 및 \"우선순위\" 항목과 **반드시 일관**되어야 합니다.",
    "",
    `## 허용 enum 값`,
    `team: ${TEAM_ORDER.join(" | ")}`,
    `phase: ${PHASE_ORDER.join(" | ")}`,
    `funnel_stage: ${FUNNEL_ORDER.join(" | ")}`,
    `cadence: ${CADENCE_ENUM.join(" | ")}`,
    `tier: ${TIER_ENUM.join(" | ")}`,
    "",
    `## 기존 task ${TASKS.length}개 (id | team | phase | funnel | title)`,
    baseList,
    "",
    "## 출력 형식 — JSON 단독 (외부 텍스트 금지)",
    `{
  "summary": "<위 마크다운 템플릿대로 작성한 마케팅 퍼널 진단 보고서 전체 (3,000자 내외 권장, 최대 6,000자)>",
  "overrides": [
    {
      "task_id": "<위 목록 중 하나>",
      "cadence_override": "weekly" | "monthly" | ...,
      "tier_boost": "must" | "conditional" | "recurring",
      "urgency_note": "한 줄 — 왜 격상했는지 (퍼널 단계명 포함)",
      "confidence": 0.0-1.0
    }
  ],
  "derived": [
    {
      "id": "derived-<영문/숫자/하이픈 슬러그>",
      "team": "<위 enum>",
      "phase": "<위 enum>",
      "funnel_stage": "<위 enum>",
      "title": "한국어 60자 이내",
      "why": "1-2 문장 — 왜 이 업무가 데이터에서 도출되었는지 (퍼널 단계명 포함)",
      "cadence": "<위 enum>",
      "tier": "<위 enum>",
      "source_insight": "원본 데이터 인사이트 한 줄 인용 (왜곡 금지)",
      "confidence": 0.0-1.0
    }
  ]
}`,
  ].join("\n");
}

function tryParseJson(raw: string): AiResponse | null {
  try {
    return JSON.parse(raw) as AiResponse;
  } catch {
    /* try fenced */
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as AiResponse;
    } catch {
      /* try brace */
    }
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as AiResponse;
    } catch {
      /* fall through */
    }
  }
  return null;
}

const TASK_ID_SET = new Set(TASKS.map((t) => t.id));
const TEAM_SET = new Set<string>(TEAM_ORDER);
const PHASE_SET = new Set<string>(PHASE_ORDER);
const FUNNEL_SET = new Set<string>(FUNNEL_ORDER);
const CADENCE_SET = new Set<string>(CADENCE_ENUM);
const TIER_SET = new Set<string>(TIER_ENUM);
const DERIVED_ID_RE = /^derived-[a-z0-9-]{1,60}$/i;

function validateOverrides(
  list: unknown[],
  signal_id: string,
  now: string,
): TaskOverride[] {
  return list.flatMap((o): TaskOverride[] => {
    if (!o || typeof o !== "object") return [];
    const r = o as Record<string, unknown>;
    const task_id = r.task_id;
    if (typeof task_id !== "string" || !TASK_ID_SET.has(task_id)) return [];
    const cadence_override =
      typeof r.cadence_override === "string" &&
      CADENCE_SET.has(r.cadence_override)
        ? (r.cadence_override as Cadence)
        : undefined;
    const tier_boost =
      typeof r.tier_boost === "string" && TIER_SET.has(r.tier_boost)
        ? (r.tier_boost as Tier)
        : undefined;
    if (!cadence_override && !tier_boost) return [];
    const urgency_note =
      typeof r.urgency_note === "string"
        ? r.urgency_note.slice(0, 200)
        : undefined;
    const confidence =
      typeof r.confidence === "number"
        ? Math.max(0, Math.min(1, r.confidence))
        : 0.6;
    return [
      {
        task_id,
        cadence_override,
        tier_boost,
        urgency_note,
        source_signal_id: signal_id,
        created_at: now,
        confidence,
      },
    ];
  });
}

function validateDerived(
  list: unknown[],
  signal_id: string,
  now: string,
): DerivedTask[] {
  const seen = new Set<string>();
  return list.flatMap((d): DerivedTask[] => {
    if (!d || typeof d !== "object") return [];
    const r = d as Record<string, unknown>;
    const id = r.id;
    if (typeof id !== "string" || !DERIVED_ID_RE.test(id)) return [];
    if (TASK_ID_SET.has(id) || seen.has(id)) return [];
    seen.add(id);
    const team = r.team;
    if (typeof team !== "string" || !TEAM_SET.has(team)) return [];
    const phase = r.phase;
    if (typeof phase !== "string" || !PHASE_SET.has(phase)) return [];
    const funnel_stage = r.funnel_stage;
    if (typeof funnel_stage !== "string" || !FUNNEL_SET.has(funnel_stage))
      return [];
    const title = r.title;
    if (typeof title !== "string" || title.trim().length === 0) return [];
    const why = r.why;
    if (typeof why !== "string" || why.trim().length === 0) return [];
    const cadence = r.cadence;
    if (typeof cadence !== "string" || !CADENCE_SET.has(cadence)) return [];
    const tier = r.tier;
    if (typeof tier !== "string" || !TIER_SET.has(tier)) return [];
    const source_insight =
      typeof r.source_insight === "string"
        ? r.source_insight.slice(0, 240)
        : "";
    const confidence =
      typeof r.confidence === "number"
        ? Math.max(0, Math.min(1, r.confidence))
        : 0.6;
    return [
      {
        id,
        team: team as Team,
        phase: phase as Phase,
        funnel_stage: funnel_stage as FunnelStage,
        title: title.slice(0, 140),
        why: why.slice(0, 320),
        cadence: cadence as Cadence,
        tier: tier as Tier,
        auto: { kind: "manual_only" },
        derived_from_signal: signal_id,
        created_at: now,
        confidence,
        source_insight,
      },
    ];
  });
}

export async function deriveWorklistChanges(
  input: DeriveInput,
): Promise<DeriveOutput> {
  const model = "claude-haiku-4-5-20251001";
  const now = new Date().toISOString();
  const signal_id = `sig-${input.workspace}-${Date.now().toString(36)}`;

  const userMessage = [
    `[데이터 소스] ${input.source}`,
    `[측정 기간] ${input.period}`,
    `[workspace] ${input.workspace}`,
    "",
    "[분석 텍스트]",
    input.text.slice(0, 50_000),
  ].join("\n");

  const resp = await anthropic().messages.create({
    model,
    max_tokens: 8000,
    temperature: 0.2,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = resp.content.reduce(
    (acc, b) => acc + (b.type === "text" ? b.text : ""),
    "",
  );

  const parsed = tryParseJson(raw);
  if (!parsed) {
    return {
      overrides: [],
      derived: [],
      summary: "(AI 응답을 JSON으로 파싱하지 못했습니다. 텍스트를 더 정돈해서 다시 시도해보세요.)",
      model,
      raw_preview: raw.slice(0, 400),
    };
  }

  const overrides = Array.isArray(parsed.overrides)
    ? validateOverrides(parsed.overrides, signal_id, now).slice(0, 8)
    : [];
  const derived = Array.isArray(parsed.derived)
    ? validateDerived(parsed.derived, signal_id, now).slice(0, 5)
    : [];
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.slice(0, 8000)
      : `${derived.length}개 신규 + ${overrides.length}개 격상 후보가 도출되었습니다.`;

  return { overrides, derived, summary, model };
}

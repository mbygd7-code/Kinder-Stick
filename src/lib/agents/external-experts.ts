/**
 * Mock external expert specialists.
 *
 * When MEETFLOW_API_BASE / MEETFLOW_API_KEY are not configured, these mock
 * experts simulate a Meetflow-style external consultation by calling Claude
 * with a domain-specialized system prompt. The output mimics the JSON shape
 * that a real third-party expert API would return.
 *
 * Real production wiring (in handoff orchestrator) replaces these with HTTP
 * POST to MEETFLOW_API_BASE + HMAC-signed payload + async callback.
 */

import { anthropic } from "@/lib/anthropic";

export type ExpertDomain =
  | "regulatory_privacy"
  | "specialized_legal"
  | "tax_accounting";

const EXPERT_PROMPTS: Record<ExpertDomain, string> = {
  regulatory_privacy: `당신은 한국 영유아 EdTech 산업의 규제·개인정보보호 전문 컨설턴트다.
주요 적용법령: 개인정보보호법(특히 22조의2 만 14세 미만 동의), KISA ISMS-P 인증기준,
방통위 아동 개인정보 가이드라인, 정보통신망법, 어린이집 평가제, 누리과정 2019 개정.

답변 시:
- 적용 조항을 명시적으로 인용 (예: "개인정보보호법 22조의2 1항에 따라...")
- 위반 시 행정처분/과태료 범위 명시
- 즉시 조치 vs 중장기 개선 분리
- KISA 자기점검 항목과의 매칭 표기
- 한국 EdTech 침해사례 참조 (있다면)`,

  specialized_legal: `당신은 한국 스타트업 전문 법률 자문가다 (특히 EdTech 영역).
주요 영역: 임원·핵심 인재 vesting/equity, IP 양수도, 표준 SAFE/CB 조항, NDA, 정보보호 약관,
아동 콘텐츠 심의, 임직원 스톡옵션, 인수합병.

답변 시:
- 한국 스타트업 표준 관행 (NfX/Sequoia 한국판) 인용
- 개정 상법/벤처기업법 조항 적용
- 위험 시나리오를 if-then 으로 분기
- 실무에서 자주 쓰는 조항 문구 예시
- 변호사 의뢰가 필요한 부분 명시 (당신은 1차 가이드일 뿐)`,

  tax_accounting: `당신은 한국 스타트업 세무·회계 전문가다.
주요 영역: 부가세 신고, R&D 세액공제 (23조 / 24조), 직장인 스톡옵션 과세,
이전가격, 해외 SaaS 매입 부가세 대리납부, 국내 SaaS 매출 세무처리.

답변 시:
- 적용 세법 조항 명시
- 절세 가능 항목 구체적 액수 추정
- 신고 일정 / 마감일 명시
- 세무사 vs 대표가 직접 처리 가능 한계 구분`,
};

export interface MockExpertInput {
  domain: ExpertDomain;
  redacted_question: string;
  redacted_context: Record<string, unknown>;
  request_id: string;
}

export interface MockExpertOutput {
  request_id: string;
  expert_finding: string;
  citations: Array<{
    kind: "law" | "guideline" | "benchmark";
    source_id: string;
    summary: string;
  }>;
  recommended_actions: Array<{
    title: string;
    deadline_days: number;
    owner_hint: string;
    risk_if_skipped: string;
  }>;
  confidence: number;
  follow_up_questions: string[];
  cost_krw: number;
  duration_ms: number;
  model: string;
}

export async function callMockExpert(
  input: MockExpertInput,
): Promise<MockExpertOutput> {
  const start = Date.now();
  const system = `${EXPERT_PROMPTS[input.domain]}

응답은 반드시 다음 JSON 만 출력 (외부 텍스트 금지):
{
  "expert_finding": "1-2 문장 요약 (가장 위험한 1지점)",
  "citations": [{"kind":"law|guideline|benchmark","source_id":"...","summary":"..."}],
  "recommended_actions": [{"title":"...","deadline_days":7,"owner_hint":"CEO|CFO|DPO|...","risk_if_skipped":"..."}],
  "confidence": 0.0-1.0,
  "follow_up_questions": ["...", "..."]
}

PII가 redacted 토큰(<EMAIL_1>, <NAME_2> 등)으로 들어와도 그것을 그대로 인용해서 답하세요.
실제 PII는 외부에 유출되지 않았습니다 — 토큰은 컨텍스트일 뿐.`;

  const userMessage = [
    "[자문 요청]",
    input.redacted_question,
    "",
    "[컨텍스트]",
    JSON.stringify(input.redacted_context, null, 2),
    "",
    `request_id: ${input.request_id}`,
  ].join("\n");

  const model = "claude-sonnet-4-6";
  const resp = await anthropic().messages.create({
    model,
    max_tokens: 2500,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const raw = resp.content.reduce(
    (acc, b) => acc + (b.type === "text" ? b.text : ""),
    "",
  );
  const parsed = parseJson(raw);

  const citations: MockExpertOutput["citations"] = Array.isArray(
    parsed?.citations,
  )
    ? parsed.citations.flatMap((c) => {
        if (!c || typeof c !== "object") return [];
        const o = c as Record<string, unknown>;
        const kind = o.kind;
        const source_id = o.source_id;
        const summary = o.summary;
        if (
          (kind === "law" || kind === "guideline" || kind === "benchmark") &&
          typeof source_id === "string" &&
          typeof summary === "string"
        ) {
          return [{ kind, source_id, summary }];
        }
        return [];
      })
    : [];

  const recommended_actions: MockExpertOutput["recommended_actions"] =
    Array.isArray(parsed?.recommended_actions)
      ? parsed.recommended_actions.flatMap((a) => {
          if (!a || typeof a !== "object") return [];
          const o = a as Record<string, unknown>;
          const title = o.title;
          const deadline_days = o.deadline_days;
          const owner_hint = o.owner_hint;
          const risk_if_skipped = o.risk_if_skipped;
          if (
            typeof title === "string" &&
            typeof deadline_days === "number" &&
            typeof owner_hint === "string" &&
            typeof risk_if_skipped === "string"
          ) {
            return [{ title, deadline_days, owner_hint, risk_if_skipped }];
          }
          return [];
        })
      : [];

  const follow_up_questions: string[] = Array.isArray(
    parsed?.follow_up_questions,
  )
    ? parsed.follow_up_questions.filter(
        (q): q is string => typeof q === "string",
      )
    : [];

  return {
    request_id: input.request_id,
    expert_finding: parsed?.expert_finding ?? "(parse failed)",
    citations,
    recommended_actions,
    confidence:
      typeof parsed?.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.6,
    follow_up_questions,
    // mock pricing — varies by domain (legal/regulatory more expensive)
    cost_krw:
      input.domain === "specialized_legal"
        ? 250000
        : input.domain === "regulatory_privacy"
          ? 180000
          : 150000,
    duration_ms: Date.now() - start,
    model,
  };
}

interface ParsedReply {
  expert_finding?: string;
  citations?: unknown[];
  recommended_actions?: unknown[];
  confidence?: number;
  follow_up_questions?: unknown[];
}

function parseJson(raw: string): ParsedReply | null {
  try {
    return JSON.parse(raw);
  } catch {
    /* try fenced */
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* try brace */
    }
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* fall through */
    }
  }
  return null;
}

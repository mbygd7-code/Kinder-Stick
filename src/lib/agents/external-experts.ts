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
  | "specialized_finance"
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
주요 영역: 공동창업자 vesting/equity, IP 양수도, 표준 SAFE/CB 조항, NDA, 정보보호 약관,
아동 콘텐츠 심의, 임직원 스톡옵션, 인수합병.

답변 시:
- 한국 스타트업 표준 관행 (NfX/Sequoia 한국판) 인용
- 개정 상법/벤처기업법 조항 적용
- 위험 시나리오를 if-then 으로 분기
- 실무에서 자주 쓰는 조항 문구 예시
- 변호사 의뢰가 필요한 부분 명시 (당신은 1차 가이드일 뿐)`,

  specialized_finance: `당신은 한국 스타트업 자금조달 전문가다 (Series A 전후, 한국 EdTech).
주요 도구: bridge round, venture debt, convertible notes, 정부 R&D 매칭펀드, 보증부 대출,
한국 VC/AC 시장 (카카오벤처스, 스파크랩, 매쉬업엔젤스, 소풍벤처스 등).

답변 시:
- 런웨이 시나리오별 정량 옵션 비교
- term sheet 핵심 조항(valuation, ratchet, liquidation pref) 검토
- 한국 시장 현실 가격 / dilution 표
- 기존 투자자 대상 bridge 안 vs 신규 라운드 vs venture debt 의 trade-off
- 즉시 / 30일 / 90일 액션 아이템`,

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
  const raw = resp.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = parseJson(raw);

  return {
    request_id: input.request_id,
    expert_finding: parsed?.expert_finding ?? "(parse failed)",
    citations: Array.isArray(parsed?.citations) ? parsed.citations : [],
    recommended_actions: Array.isArray(parsed?.recommended_actions)
      ? parsed.recommended_actions
      : [],
    confidence:
      typeof parsed?.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.6,
    follow_up_questions: Array.isArray(parsed?.follow_up_questions)
      ? parsed.follow_up_questions
      : [],
    // mock pricing — varies by domain (legal/regulatory more expensive)
    cost_krw:
      input.domain === "specialized_legal"
        ? 250000
        : input.domain === "regulatory_privacy"
          ? 180000
          : input.domain === "specialized_finance"
            ? 200000
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

/**
 * POST /api/ops-context/[workspace]/growth-feasibility
 *
 * OpsContext + 영유아 EdTech 시장 맥락으로 목표 달성 가능성 분석.
 * Claude haiku-4-5 가 다음을 평가:
 *   - feasibility_pct: 0-100 (현 상태 그대로 유지 시 가능성)
 *   - key_factors: 결정 변수 5-7개 (이름·값·영향)
 *   - scenarios: 2-3개 시나리오 (현 상태 / 보강 / 최선)
 *   - caveats: AI 추정 한계 명시
 *
 * 비용: 1 Claude API call per request.
 * 사용자가 명시적으로 "AI 심화 분석" 버튼 클릭 시에만 호출 (auto-run X).
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { SERVICE_KNOWLEDGE_KO } from "@/lib/service-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

interface GrowthFeasibilityResult {
  feasibility_pct: number;
  summary: string;
  key_factors: Array<{
    name: string;
    value: string;
    impact: "positive" | "neutral" | "negative" | "blocker";
    note: string;
  }>;
  scenarios: Array<{
    label: string;
    probability_pct: number;
    required_actions: string[];
    reasoning: string;
  }>;
  caveats: string[];
  /** 현재 운영·자원·시간 변수 기반 합리적 목표 추천. null = 추천 불가. */
  recommended_goals: {
    goal_new_signups_monthly?: number | null;
    goal_paid_users_monthly?: number | null;
    goal_plc_monthly?: number | null;
    goal_total_members_annual?: number | null;
    goal_paid_subscribers_annual?: number | null;
    goal_plc_annual?: number | null;
  };
}

const SYSTEM_PROMPT = `당신은 카인더스틱(Kinder Stick) 운영진을 돕는 시니어 전략 컨설턴트다.
회사 운영 현황·목표·성장 컨텍스트(출시일·팀·예산·경쟁)를 받아 목표 달성
가능성을 다요인 분석한다.

${SERVICE_KNOWLEDGE_KO}

## 분석 원칙
1. **단순 ratio 만으로 판단 X** — 시간·자본·인력·경쟁 모두 고려
2. **위 카인더스틱 가격(22,900원·무료 크레딧·추가 크레딧 정책) 그대로 사용**
   다른 가격·정책 임의 제안 X
3. **시간 변수**:
   - 서비스 출시 후 처음 6개월 = 사용자 발견·PMF 검증 (성장 느림)
   - 6-18개월 = product-market fit 확정 후 본격 성장 (2-5배 가능)
   - 18개월+ = 안정 성장 (1.5-2배/년)
4. **자본 변수 — 월간 성장 투자 가용액 (monthly_growth_budget_krw)**:
   - 월 5천만원 미만 = 1-2개 채널 집중 (제한적 실험)
   - 월 5천만 ~ 1.5억 = 다채널 실험 + 신규 채용 1-2명 가능
   - 월 1.5억 ~ 3억 = 퍼포먼스 마케팅 본격 + 신규 채용 3-5명
   - 월 3억+ = 전사 가속 모드 (브랜딩·B2B 영업·다국가 등 병행)
   런웨이 X — 회사 의지·가용 자본 결합한 월 가용 투자 규모
5. **팀 변수**: 5명 = 한 가지에 집중, 20명+ = 다 채널 병행
6. **경쟁 변수**: high (다수 추격) 시 first-mover 우위 1년 내 소멸

## 출력 형식 — JSON 만, 코멘트·설명·코드블록 X
{
  "feasibility_pct": 0-100,
  "summary": "1-2 문장 함축 요약 (직원이 한눈에 핵심 파악) — 80자 내외",
  "key_factors": [
    {
      "name": "변수명 (예: 월간 성장 투자 가용액) — 짧게",
      "value": "현재 값 (예: 1.5억 KRW)",
      "impact": "positive | neutral | negative | blocker",
      "note": "왜 영향 주나 — 1 문장 (50자 내외)"
    }
  ],
  "// note": "key_factors 4-6 개. blocker/negative 가 있다면 우선 포함.",
  "scenarios": [
    {
      "label": "현 상태 유지 시",
      "probability_pct": 0-100,
      "required_actions": [],
      "reasoning": "왜 이 확률인지"
    },
    {
      "label": "보강 시나리오 (예: 마케팅 예산 2배 + 채용 3명)",
      "probability_pct": 0-100,
      "required_actions": ["구체 액션 1", "구체 액션 2"],
      "reasoning": "..."
    }
  ],
  "caveats": [
    "AI 추정치이며 절대값 X. 의사결정 보조용.",
    "한국 영유아 EdTech 일반 패턴 기반. 자사 특수성 추가 고려 필요."
  ],
  "recommended_goals": {
    "goal_new_signups_monthly": number | null,
    "goal_paid_users_monthly": number | null,
    "goal_plc_monthly": number | null,
    "goal_total_members_annual": number | null,
    "goal_paid_subscribers_annual": number | null,
    "goal_plc_annual": number | null
  }
}

## recommended_goals 산출 가이드
현재 운영 + 가용 자원 + 시간 + 경쟁 변수 기반으로 1년 (또는 1개월) 안에
70-80% 가능성으로 달성 가능한 합리적 목표 숫자를 추천한다.

- 현재 신규 가입 1,200명/월 + 월 예산 1.5억 → 추천 신규 가입 ~2,500/월
  (2배 정도가 자본·팀으로 무리 없이 달성 가능)
- 현재 유료 5%, MAU 8,000 → 추천 유료 600/월 (전환율 7-8% 도달 목표)
- PLC 운영 안 하면 null
- 데이터 부족하면 해당 필드 null

사용자가 입력한 목표(goal_*) 와 다를 수 있다. 추천은 AI 가 보기에 합리적인
값이며, 사용자 목표가 비현실적이면 좀 더 현실적인 추천을 제시.

## 금지
- 데이터에 없는 가짜 숫자/사실 만들지 마라
- **카인더스틱 가격을 22,900원 외의 값으로 임의 제시 X**
  · 예 금지: "월 9,900원 → 14,900원으로 인상"
  · 예 금지: "연 구독 할인 도입"
  · 가격 조정 제안 시: "현재 22,900원 — 추가 크레딧 패키지 가격 재검토" 같이
    실제 정책 안에서만 제안
- "비현실적" 같은 가치 판단 X — 객관 분석만
- 시장 데이터 인용 시 출처 모르면 "일반적 영유아 EdTech 패턴" 으로 명시
- recommended_goals 는 항상 객체로 반환 (모든 필드 null 이라도)`;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ workspace: string }> },
) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }

  const { workspace } = await ctx.params;
  if (!WS_PATTERN.test(workspace)) {
    return NextResponse.json(
      { ok: false, message: "workspace 형식 오류" },
      { status: 400 },
    );
  }

  // body 에 draft ops 가 있으면 우선 사용 (commit 안 한 상태에서도 분석 가능),
  // 없으면 DB 최신 commit 에서 fetch.
  let body: { ops?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    // body 없어도 OK (DB fallback)
  }

  let opsData: Record<string, unknown>;
  if (body.ops && typeof body.ops === "object" && !Array.isArray(body.ops)) {
    opsData = body.ops as Record<string, unknown>;
  } else {
    const sb = supabaseAdmin();
    const { data: row } = await sb
      .from("kso_ops_context")
      .select("data")
      .eq("workspace_id", workspace)
      .maybeSingle();
    opsData = (row?.data as Record<string, unknown> | null) ?? {};
  }

  if (Object.keys(opsData).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "운영 컨텍스트가 비어있습니다. 현황·목표를 입력하고 다시 시도하세요.",
      },
      { status: 400 },
    );
  }

  // Claude 호출
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: "ANTHROPIC_API_KEY 미설정" },
      { status: 500 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = `## 오늘 날짜
${today}

## OpsContext (회사 운영 현황·목표·성장 컨텍스트)
${JSON.stringify(opsData, null, 2)}

## 분석 요청
위 데이터로 목표 달성 가능성을 다요인 분석. JSON 만 반환 (시스템 프롬프트 형식대로).`;

  try {
    const client = new Anthropic({ apiKey });
    const completion = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = completion.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");

    // JSON 추출 — 견고하게:
    // 1) markdown fence 제거
    // 2) 첫 '{' 와 마지막 '}' 사이 substring 만 추출 (preamble/postamble 제거)
    // 3) 일부 trailing comma 같은 흔한 오류는 그대로 두고 파싱 시도
    const parsed = extractAndParseJson<GrowthFeasibilityResult>(text);
    if (!parsed) {
      console.error("Claude returned invalid JSON:", text.slice(0, 800));
      return NextResponse.json(
        {
          ok: false,
          message: "AI 응답 파싱 실패 — 다시 시도하세요",
          raw_preview: text.slice(0, 300),
        },
        { status: 500 },
      );
    }

    // 기본 검증
    if (
      typeof parsed.feasibility_pct !== "number" ||
      !Array.isArray(parsed.scenarios) ||
      !Array.isArray(parsed.key_factors)
    ) {
      return NextResponse.json(
        { ok: false, message: "AI 응답 형식 부적합" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      result: parsed,
      evaluated_at: new Date().toISOString(),
      model: "claude-haiku-4-5-20251001",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, message: `AI 호출 실패: ${msg}` },
      { status: 500 },
    );
  }
}

/**
 * 견고한 JSON 추출 — Claude 가 markdown fence·preamble·postamble 을 추가해도
 * 첫 '{' 와 마지막 '}' 사이의 substring 만 잘라 파싱 시도.
 * 흔한 LLM trailing comma 도 strip 시도.
 */
function extractAndParseJson<T>(raw: string): T | null {
  if (!raw) return null;

  // 1. markdown fence 제거
  let s = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // 2. preamble/postamble — 첫 { 와 마지막 } 사이만
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  s = s.slice(first, last + 1);

  // 3. 직접 시도
  try {
    return JSON.parse(s) as T;
  } catch {
    // 4. trailing comma 제거 — 흔한 LLM 오류 (",}" or ",]")
    const repaired = s
      .replace(/,(\s*[}\]])/g, "$1")
      // smart quotes → 일반 quote
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    try {
      return JSON.parse(repaired) as T;
    } catch {
      return null;
    }
  }
}

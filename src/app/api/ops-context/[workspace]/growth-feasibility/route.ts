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
}

const SYSTEM_PROMPT = `당신은 한국 영유아 EdTech 운영진을 돕는 시니어 전략 컨설턴트다.
회사 운영 현황·목표·성장 컨텍스트(출시일·팀·런웨이·경쟁)를 받아 목표 달성
가능성을 다요인 분석한다.

## 분석 원칙
1. **단순 ratio 만으로 판단 X** — 시간·자본·인력·경쟁 모두 고려
2. **한국 영유아 EdTech 맥락**:
   - 주 결정자 = 교사 (B2C teacher subscription + B2B 어린이집·유치원 계약)
   - 시장 사이즈: 어린이집 ~36K + 유치원 ~9K, 교사 ~30만명
   - 일반적 freemium 유료 전환: 5-10% (B2C), 20-30% (B2B 단체 결제)
   - 신규 가입 채널: 동료 추천·키더 매트·보육교사 카페·인플루언서·B2B 영업
3. **시간 변수**:
   - 서비스 출시 후 처음 6개월 = 사용자 발견·PMF 검증 (성장 느림)
   - 6-18개월 = product-market fit 확정 후 본격 성장 (2-5배 가능)
   - 18개월+ = 안정 성장 (1.5-2배/년)
4. **자본 변수**: 런웨이 6개월 미만 = 보수 모드, 18개월+ = 공격 가능
5. **팀 변수**: 5명 = 한 가지에 집중, 20명+ = 다 채널 병행
6. **경쟁 변수**: high (다수 추격) 시 first-mover 우위 1년 내 소멸

## 출력 형식 — JSON 만, 코멘트·설명·코드블록 X
{
  "feasibility_pct": 0-100,
  "summary": "한 문단 (3-5 문장) 종합 평가",
  "key_factors": [
    {
      "name": "변수명 (예: 자금 런웨이)",
      "value": "현재 값 (예: 8개월)",
      "impact": "positive | neutral | negative | blocker",
      "note": "왜 이 변수가 영향을 주나"
    }
  ],
  "scenarios": [
    {
      "label": "현 상태 유지 시",
      "probability_pct": 0-100,
      "required_actions": [],
      "reasoning": "왜 이 확률인지"
    },
    {
      "label": "보강 시나리오 (예: 시리즈 A + 채용 3명)",
      "probability_pct": 0-100,
      "required_actions": ["구체 액션 1", "구체 액션 2"],
      "reasoning": "..."
    }
  ],
  "caveats": [
    "AI 추정치이며 절대값 X. 의사결정 보조용.",
    "한국 영유아 EdTech 일반 패턴 기반. 자사 특수성 추가 고려 필요."
  ]
}

## 금지
- 데이터에 없는 가짜 숫자/사실 만들지 마라
- "비현실적" 같은 가치 판단 X — 객관 분석만
- 시장 데이터 인용 시 출처 모르면 "일반적 영유아 EdTech 패턴" 으로 명시`;

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

  // OpsContext 서버에서 fetch (최신 commit)
  const sb = supabaseAdmin();
  const { data: row } = await sb
    .from("kso_ops_context")
    .select("data")
    .eq("workspace_id", workspace)
    .maybeSingle();
  const opsData = (row?.data as Record<string, unknown> | null) ?? {};

  if (Object.keys(opsData).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "운영 컨텍스트가 비어있습니다. 현황·목표를 입력 후 진단에 반영 먼저 누르세요.",
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
      max_tokens: 2500,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = completion.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");

    // JSON 추출 (혹시 fence 가 있으면 제거)
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    let parsed: GrowthFeasibilityResult;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("Claude returned invalid JSON:", text.slice(0, 500));
      return NextResponse.json(
        {
          ok: false,
          message: "AI 응답 파싱 실패 — 다시 시도하세요",
          raw_preview: text.slice(0, 200),
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

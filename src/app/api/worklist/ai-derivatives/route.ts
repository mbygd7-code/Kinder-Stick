import { NextResponse } from "next/server";
import { anthropic } from "@/lib/anthropic";

interface Body {
  original: string;
  why?: string;
  description?: string;
  team?: string;
  phase?: string;
  funnel_stage?: string;
}

/**
 * AI-generated derivatives for a single worklist task.
 *
 * 카탈로그의 다른 업무를 추천하는 게 아니라, **현재 업무의 확장·파생** 3개를
 * 생성한다. 예: '교사 리더 페르소나 정의' → ['5–7세 누리과정 교사 페르소나 v1',
 * '가정어린이집 원장-교사 페르소나 v1', '교사 리더 페르소나 검증 인터뷰 8명'].
 *
 * 결과는 JSON 배열 (3 entries, 각 60자 이내).
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const original = (body.original ?? "").slice(0, 240);
  if (!original) {
    return NextResponse.json({ error: "missing_original" }, { status: 400 });
  }
  const why = (body.why ?? "").slice(0, 320);
  const description = (body.description ?? "").slice(0, 600);

  try {
    const r = await anthropic().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0.6,
      system: [
        "당신은 한국 EdTech 운영팀의 PD입니다.",
        "주어진 업무를 더 구체적이고 실행 가능한 작은 변형 3개로 쪼갭니다.",
        "출력 규칙:",
        "- 정확히 JSON 배열 형식으로만 답하세요. 다른 텍스트 절대 금지.",
        "- 배열 길이 3, 각 항목은 한국어 한 문장 (최대 60자).",
        "- 각 변형은 ① 세그먼트 좁히기 ② 단계 쪼개기 ③ 검증·인터뷰·실험 형태 중 하나로 만드세요.",
        "- 원본 업무를 그대로 복사하지 말고 ‘확장’ 또는 ‘파생’이어야 합니다.",
        "- 카탈로그의 다른 업무와 중복되지 않게 좁고 구체적으로.",
        "예: 원본 = '교사 리더 페르소나 정의'",
        "→ ['5–7세 누리과정 교사 페르소나 v1 작성', '가정어린이집 원장-교사 페르소나 v1 작성', '교사 리더 페르소나 검증 인터뷰 8명']",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `원본 업무: ${original}`,
            why ? `왜 필요한가: ${why}` : null,
            description ? `상세: ${description.slice(0, 300)}` : null,
            body.team ? `팀: ${body.team}` : null,
            body.phase ? `단계: ${body.phase}` : null,
            body.funnel_stage ? `고객여정: ${body.funnel_stage}` : null,
            "",
            "위 원본을 더 구체화한 변형 3개를 JSON 배열로만 답하세요.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    const text = r.content
      .filter((b): b is { type: "text"; text: string } & typeof b =>
        b.type === "text",
      )
      .map((b) => b.text)
      .join("")
      .trim();

    // Parse JSON array tolerantly: find first '[' and last ']'
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      return NextResponse.json(
        { error: "parse_failed", raw: text.slice(0, 200) },
        { status: 502 },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return NextResponse.json(
        { error: "parse_failed", raw: text.slice(0, 200) },
        { status: 502 },
      );
    }
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "not_array", raw: text.slice(0, 200) },
        { status: 502 },
      );
    }

    const derivatives = parsed
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 120))
      .slice(0, 3);

    if (derivatives.length === 0) {
      return NextResponse.json({ error: "empty_response" }, { status: 502 });
    }

    return NextResponse.json({ derivatives });
  } catch (e) {
    return NextResponse.json(
      {
        error: "anthropic_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}

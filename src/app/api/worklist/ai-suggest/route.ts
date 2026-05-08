import { NextResponse } from "next/server";
import { anthropic } from "@/lib/anthropic";

interface Body {
  original: string;
  why?: string;
  team?: string;
  phase?: string;
  current?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const original = (body.original ?? "").slice(0, 240);
  const current = (body.current ?? "").slice(0, 240);
  const why = (body.why ?? "").slice(0, 320);

  if (!original) {
    return NextResponse.json({ error: "missing_original" }, { status: 400 });
  }

  try {
    const r = await anthropic().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      temperature: 0.4,
      system: [
        "당신은 한국 EdTech 운영팀의 PD입니다.",
        "워크리스트의 업무 제목을 한 문장으로 간결하게 다듬어 주세요.",
        "출력 규칙:",
        "- 반드시 한국어 한 문장 (최대 60자)",
        "- 행동 동사로 시작 (예: 측정, 발송, 구축, 점검, 분석)",
        "- 불필요한 수식어·이모지·따옴표 금지",
        "- JSON·마크다운·설명 절대 금지 — 본문 텍스트만",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `원본: ${original}`,
            why ? `왜 필요한가: ${why}` : null,
            current && current !== original
              ? `사용자 현재 입력: ${current}`
              : null,
            "이 업무 제목을 위 규칙으로 다듬어 한 문장으로만 답하세요.",
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
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .split("\n")[0]
      .slice(0, 120);

    if (!text) {
      return NextResponse.json({ error: "empty_response" }, { status: 502 });
    }

    return NextResponse.json({ suggestion: text });
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

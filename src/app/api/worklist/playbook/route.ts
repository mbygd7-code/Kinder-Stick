import { NextResponse } from "next/server";
import {
  generatePlaybook,
  type PlaybookInput,
} from "@/lib/agents/worklist-playbook";

interface Body {
  task_id?: string;
  title?: string;
  why?: string;
  team?: string;
  phase?: string;
  funnel_stage?: string;
  cadence?: string;
  tier?: string;
  domain?: string;
  hint?: string;
  ai_leverage?: string;
  /** 사용자가 진단 전에 입력한 회사 현황·목표 (Ops Context).
   *  AI 가 사용자의 실제 MAU·매출·목표 회원 수 등을 기반으로 맞춤 플레이북을 생성하도록 사용됨. */
  ops_context?: Record<string, unknown>;
}

/**
 * POST /api/worklist/playbook
 *
 * 특정 task에 대해 AI가 실무 플레이북(산출물·단계·KPI·샘플 템플릿·실수·참고
 * 자료)을 생성한다. 클라이언트가 localStorage에 캐시하므로 같은 task 재요청은
 * 발생하지 않는다.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const task_id = (body.task_id ?? "").trim();
  const title = (body.title ?? "").trim();
  const why = (body.why ?? "").trim();
  if (!task_id || !title || !why) {
    return NextResponse.json(
      { error: "missing_fields", required: ["task_id", "title", "why"] },
      { status: 400 },
    );
  }

  const input: PlaybookInput = {
    task_id: task_id.slice(0, 80),
    title: title.slice(0, 200),
    why: why.slice(0, 800),
    team: (body.team ?? "").slice(0, 30) || "unknown",
    phase: (body.phase ?? "").slice(0, 30) || "unknown",
    funnel_stage: body.funnel_stage?.slice(0, 30),
    cadence: (body.cadence ?? "").slice(0, 30) || "unknown",
    tier: (body.tier ?? "").slice(0, 30) || "unknown",
    domain: body.domain?.slice(0, 30),
    hint: body.hint?.slice(0, 400),
    ai_leverage: body.ai_leverage?.slice(0, 400),
    ops_context:
      body.ops_context && typeof body.ops_context === "object"
        ? body.ops_context
        : undefined,
  };

  try {
    const result = await generatePlaybook(input);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: "playbook_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}

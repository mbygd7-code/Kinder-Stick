/**
 * GET /api/_internal/tasks
 *
 * 내부용 — `scripts/generate-default-playbooks.mjs` 가 카탈로그 + task_hash 를
 * 한 번에 가져가기 위해 사용. 프로덕션 보안을 위해 NODE_ENV=production 에서는 404.
 *
 * 응답: Array<{ id, title, why, team, phase, funnel_stage, cadence, tier, domain,
 *               hint, ai_leverage, task_hash }>
 */

import { NextResponse } from "next/server";
import { TASKS, getAiLeverage, getFunnelStage } from "@/lib/worklist/catalog";
import { taskContentHash } from "@/lib/worklist/playbook-cache";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }
  const out = TASKS.map((t) => ({
    id: t.id,
    title: t.title,
    why: t.why,
    team: t.team,
    phase: t.phase,
    funnel_stage: getFunnelStage(t),
    cadence: t.cadence,
    tier: t.tier,
    domain: t.domain,
    hint: t.hint,
    ai_leverage: getAiLeverage(t),
    task_hash: taskContentHash(t),
  }));
  return NextResponse.json(out);
}

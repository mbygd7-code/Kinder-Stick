/**
 * Cross-card aggregate — 여러 진단 카드의 데이터를 가중 합산.
 *
 * 사용 시나리오:
 *   - 홈 (/) 랜딩 페이지 hero — 사용자가 보유한 모든 카드의 종합 건강도
 *   - 같은 워크스페이스 응답 = weight 1.0 (현재 카드 100% 반영)
 *   - 다른 워크스페이스 = weight 0.3 (참고 데이터로 일부 반영)
 *
 * 우선순위:
 *   - currentWorkspace 가 지정되면 그 카드를 "100% 반영" 으로 강조
 *   - 그렇지 않으면 모든 카드를 0.3 으로 평균 (일반 메타뷰)
 *
 * 출력은 한 개의 통합 점수 + 6개월/12개월 실패확률.
 */

import type { FrameworkConfig } from "@/lib/framework/loader";
import {
  aggregateRespondents,
  type DiagRowMin,
  type AggregateResult,
} from "@/lib/diagnosis-aggregate";

export interface PerWorkspaceAggregate extends AggregateResult {
  workspace_id: string;
  respondent_count: number;
}

export interface CrossCardAggregate {
  /** 카드별 개별 결과 (정렬: 최신 응답순 또는 점수 낮은 순) */
  per_workspace: PerWorkspaceAggregate[];

  /** 모든 카드 합산 결과 (가중치 반영) */
  combined: {
    overall: number | null;
    failure_6m: number;
    failure_12m: number;
    weighted_workspace_count: number;
    total_responses: number;
  };

  /** "현재 카드" 가 있을 때 그 카드의 단독 결과 */
  primary?: PerWorkspaceAggregate;

  /** 가장 위험한 카드 (failure_6m 가장 높은) */
  worst?: PerWorkspaceAggregate;

  /** 가장 좋은 카드 */
  best?: PerWorkspaceAggregate;
}

type DiagRowWithWorkspace = DiagRowMin & {
  workspace_id: string;
};

/**
 * @param rows 전 워크스페이스 응답 통합 (limit 500 권장)
 * @param currentWorkspace 강조할 카드 (있으면 100%, 없으면 모두 0.3)
 */
export function aggregateCrossCard(
  framework: FrameworkConfig,
  rows: DiagRowWithWorkspace[],
  currentWorkspace?: string,
): CrossCardAggregate {
  if (rows.length === 0) {
    return {
      per_workspace: [],
      combined: {
        overall: null,
        failure_6m: 0,
        failure_12m: 0,
        weighted_workspace_count: 0,
        total_responses: 0,
      },
    };
  }

  // 워크스페이스별로 그룹핑
  const byWs = new Map<string, DiagRowMin[]>();
  for (const row of rows) {
    const ws = row.workspace_id;
    const list = byWs.get(ws);
    if (list) list.push(row);
    else byWs.set(ws, [row]);
  }

  const per_workspace: PerWorkspaceAggregate[] = [];
  for (const [ws, list] of byWs.entries()) {
    const agg = aggregateRespondents(framework, list);
    per_workspace.push({
      ...agg,
      workspace_id: ws,
      respondent_count: list.length,
    });
  }

  // 정렬: 6m failure 내림차순 (위험한 카드 먼저)
  per_workspace.sort((a, b) => b.fp["6m"].final - a.fp["6m"].final);

  // 가중 합산
  const PRIMARY_W = 1.0;
  const OTHER_W = 0.3;

  let weightedOverall = 0;
  let weightedFail6 = 0;
  let weightedFail12 = 0;
  let totalW = 0;
  let totalResponses = 0;
  let primary: PerWorkspaceAggregate | undefined;

  for (const pw of per_workspace) {
    const isPrimary = currentWorkspace && pw.workspace_id === currentWorkspace;
    const w = isPrimary ? PRIMARY_W : OTHER_W;
    if (isPrimary) primary = pw;

    if (pw.overall !== null) {
      weightedOverall += pw.overall * w;
    }
    weightedFail6 += pw.fp["6m"].final * w;
    weightedFail12 += pw.fp["12m"].final * w;
    totalW += w;
    totalResponses += pw.respondent_count;
  }

  // currentWorkspace 가 지정됐는데 매칭되는 응답이 없으면 fallback
  if (currentWorkspace && !primary) {
    // 모두 0.3 로 처리하지 않고, 가장 최근 카드를 fallback primary 로
    primary = per_workspace[0];
  }

  // worst / best
  const worst = per_workspace[0]; // failure_6m desc 정렬이라 0번이 worst
  const best = per_workspace[per_workspace.length - 1];

  return {
    per_workspace,
    combined: {
      overall: totalW > 0 ? weightedOverall / totalW : null,
      failure_6m: totalW > 0 ? weightedFail6 / totalW : 0,
      failure_12m: totalW > 0 ? weightedFail12 / totalW : 0,
      weighted_workspace_count: totalW,
      total_responses: totalResponses,
    },
    primary,
    worst,
    best,
  };
}

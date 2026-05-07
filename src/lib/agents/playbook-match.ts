/**
 * Playbook matcher — playbooks.yaml의 trigger와 응답 데이터를 매칭한다.
 *
 * MVP: 도메인이 일치하고, primary trigger의 evidence.v 조건이 만족되면 매칭.
 * 더 복잡한 표현(AND/OR, KPI 참조 등)은 Phase 3에서 KPI 연동 후 확장.
 */

import { loadPlaybooks, type Playbook } from "@/lib/framework/loader";
import type { PlaybookSummary } from "./build-prompt";

interface ResponseMap {
  [sub_item_code: string]: { evidence: number | null; na?: boolean };
}

/**
 * 도메인 코드와 응답 맵을 받아 매칭되는 playbook 1-3개를 반환.
 */
export function matchPlaybooks(
  domainCode: string,
  responses: ResponseMap,
  fallbackToAll = true,
): PlaybookSummary[] {
  const all = loadPlaybooks().playbooks.filter((p) => p.domain === domainCode);
  if (all.length === 0) return [];

  const matched = all.filter((p) => evaluateTrigger(p.trigger.primary, responses));

  // 매칭 0건이면 (fallback) 도메인의 모든 playbook을 후보로 — 최대 3개
  const result = matched.length > 0 ? matched : fallbackToAll ? all : [];
  return result.slice(0, 3).map(toSummary);
}

function toSummary(p: Playbook): PlaybookSummary {
  return {
    id: p.id,
    title: p.title,
    diagnostic_q: p.diagnostic_q,
    smart_actions: p.smart_actions,
    verify: p.verify,
    cite: p.cite,
  };
}

/**
 * Trigger 표현 단순 evaluator.
 * 지원 패턴:
 *   - "<sub_item>.evidence.v <= N"
 *   - "<sub_item>.evidence.v == N"
 *   - "<sub_item>.evidence.v >= N"
 *   - "<sub_item>.evidence.v < N"
 *   - "AND" 결합 (가장 단순한 형태만)
 *
 * 매칭 안 되거나 파싱 실패 시 false.
 */
function evaluateTrigger(expr: string, responses: ResponseMap): boolean {
  if (!expr) return false;
  const clauses = expr.split(/\s+AND\s+/i);
  return clauses.every((clause) => evaluateClause(clause.trim(), responses));
}

const CLAUSE_RE =
  /^([A-Z]\d{1,2}(?:\.[A-Z_]+)+)\.evidence\.v\s*(<=|>=|==|<|>)\s*(\d)/;

function evaluateClause(clause: string, responses: ResponseMap): boolean {
  const m = clause.match(CLAUSE_RE);
  if (!m) {
    // Unsupported clause (e.g. external KPI) → conservatively false so matching
    // doesn't fire spuriously. Fallback path will catch domain-level matches.
    return false;
  }
  const [, code, op, nStr] = m;
  const n = Number(nStr);
  const r = responses[code];
  if (!r || r.evidence === null || r.na) return false;
  const v = r.evidence;
  switch (op) {
    case "<=":
      return v <= n;
    case ">=":
      return v >= n;
    case "==":
      return v === n;
    case "<":
      return v < n;
    case ">":
      return v > n;
    default:
      return false;
  }
}

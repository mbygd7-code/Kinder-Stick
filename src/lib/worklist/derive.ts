/**
 * Worklist auto-status deriver.
 *
 * 워크스페이스 데이터(응답·액션·코칭·KPI·외부 호출)를 한 번 읽고,
 * catalog의 각 task에 대해 auto status(또는 'unknown')를 계산.
 *
 * 수동 override는 클라이언트에서 localStorage로 처리.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutoRule, Status, Task } from "./catalog";

export interface WorkspaceFacts {
  workspaceId: string;
  orgId: string | null;
  // diagnosis
  totalRespondents: number;
  hasAnyResponse: boolean;
  latestDiagnosisAt: string | null;
  respondedDomains: Set<string>; // domain codes that have at least one response
  recentEvidenceDomains: Set<string>; // domain codes with evidence within 90d
  // actions
  hasOverdue: boolean;
  verifiedActionsCount: number;
  redCriticalAllHaveOwner: boolean;
  redCriticalAnyHasAction: boolean;
  // coaching
  domainsWithSession: Set<string>;
  domainsWithResolvedSession: Set<string>;
  highSeverityFindings: number; // severity ≥ 4 unresolved
  // external
  externalCallsCount: number;
  // integrations
  connectedKpiSources: Set<string>;
  // KPI freshness
  kpiMetricLatestDays: Map<string, number>;
}

// ============================================================
// Fetch facts in one round-trip
// ============================================================

interface MinAction {
  status: string;
  deadline: string | null;
  owner_role: string | null;
  smart_payload: Record<string, unknown> | null;
  domain_code?: string | null;
}

interface MinSession {
  domain_code: string;
  state: string;
  severity: number;
}

interface MinResponse {
  sub_item_code: string;
  evidence_recorded_at: string | null;
  data_source: string | null;
}

interface MinKpiMapping {
  source: string;
}

interface MinSnapshot {
  metric_key: string;
  captured_at: string;
}

export async function loadWorkspaceFacts(
  sb: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceFacts> {
  // Resolve org
  const { data: org } = await sb
    .from("organizations")
    .select("id")
    .eq("name", workspaceId)
    .maybeSingle();
  const orgId = (org?.id as string | undefined) ?? null;

  if (!orgId) {
    return emptyFacts(workspaceId);
  }

  const [
    diagRespRes,
    responsesRes,
    actionsRes,
    sessionsRes,
    externalRes,
    integRes,
    kpiSnapRes,
  ] = await Promise.all([
    sb
      .from("diagnosis_responses")
      .select("respondent_num, completed_at")
      .eq("workspace_id", workspaceId),
    sb
      .from("sub_item_responses")
      .select("sub_item_code, evidence_recorded_at, data_source")
      .eq("org_id", orgId),
    sb
      .from("coaching_actions")
      .select(
        "status, deadline, owner_role, smart_payload, domain_code",
      )
      .eq("org_id", orgId),
    sb
      .from("agent_sessions")
      .select("domain_code, state, severity")
      .eq("org_id", orgId),
    sb
      .from("external_ai_calls")
      .select("id")
      .eq("org_id", orgId),
    sb
      .from("metric_definitions")
      .select("source")
      .eq("org_id", orgId),
    sb
      .from("kpi_snapshots")
      .select("metric_key, captured_at")
      .eq("org_id", orgId)
      .order("captured_at", { ascending: false })
      .limit(200),
  ]);

  const diagRows = (diagRespRes.data ?? []) as Array<{
    respondent_num: number;
    completed_at: string;
  }>;
  const totalRespondents = new Set(diagRows.map((d) => d.respondent_num)).size;
  const latestDiagnosisAt =
    diagRows
      .map((d) => d.completed_at)
      .filter((x) => !!x)
      .sort()
      .pop() ?? null;

  const responses = (responsesRes.data ?? []) as MinResponse[];
  const respondedDomains = new Set(
    responses.map((r) => r.sub_item_code.split(".")[0]),
  );
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recentEvidenceDomains = new Set(
    responses
      .filter(
        (r) =>
          r.evidence_recorded_at &&
          new Date(r.evidence_recorded_at).getTime() >= ninetyDaysAgo,
      )
      .map((r) => r.sub_item_code.split(".")[0]),
  );

  const actions = (actionsRes.data ?? []) as MinAction[];
  const now = Date.now();
  const hasOverdue = actions.some(
    (a) =>
      (a.status === "accepted" || a.status === "in_progress") &&
      a.deadline &&
      new Date(a.deadline).getTime() < now,
  );
  const verifiedActionsCount = actions.filter((a) => a.status === "verified").length;

  const sessions = (sessionsRes.data ?? []) as MinSession[];
  const domainsWithSession = new Set(sessions.map((s) => s.domain_code));
  const domainsWithResolvedSession = new Set(
    sessions
      .filter((s) => s.state === "resolved" || s.state === "rescoring")
      .map((s) => s.domain_code),
  );
  const highSeverityFindings = sessions.filter(
    (s) =>
      s.severity >= 4 &&
      !["resolved", "rescoring"].includes(s.state),
  ).length;

  // Red critical detection: actions whose smart_payload.domain or domain_code maps to a critical domain
  // (we don't pull framework here — caller passes critical_red codes if needed)
  // Use domain_code on actions:
  const redCriticalDomains = new Set(
    actions.map((a) => a.domain_code).filter((x): x is string => !!x),
  );
  const redCriticalAllHaveOwner =
    redCriticalDomains.size > 0 &&
    actions
      .filter((a) => redCriticalDomains.has(a.domain_code as string))
      .every((a) => a.owner_role && a.owner_role.length > 0);
  const redCriticalAnyHasAction = redCriticalDomains.size > 0;

  const externalCallsCount = (externalRes.data ?? []).length;
  const connectedKpiSources = new Set(
    ((integRes.data ?? []) as MinKpiMapping[]).map((r) => r.source),
  );

  const kpiSnapshots = (kpiSnapRes.data ?? []) as MinSnapshot[];
  const kpiMetricLatestDays = new Map<string, number>();
  const seen = new Set<string>();
  for (const s of kpiSnapshots) {
    if (seen.has(s.metric_key)) continue;
    seen.add(s.metric_key);
    const days = Math.floor(
      (now - new Date(s.captured_at).getTime()) / (24 * 60 * 60 * 1000),
    );
    kpiMetricLatestDays.set(s.metric_key, days);
  }

  return {
    workspaceId,
    orgId,
    totalRespondents,
    hasAnyResponse: diagRows.length > 0,
    latestDiagnosisAt,
    respondedDomains,
    recentEvidenceDomains,
    hasOverdue,
    verifiedActionsCount,
    redCriticalAllHaveOwner,
    redCriticalAnyHasAction,
    domainsWithSession,
    domainsWithResolvedSession,
    highSeverityFindings,
    externalCallsCount,
    connectedKpiSources,
    kpiMetricLatestDays,
  };
}

function emptyFacts(workspaceId: string): WorkspaceFacts {
  return {
    workspaceId,
    orgId: null,
    totalRespondents: 0,
    hasAnyResponse: false,
    latestDiagnosisAt: null,
    respondedDomains: new Set(),
    recentEvidenceDomains: new Set(),
    hasOverdue: false,
    verifiedActionsCount: 0,
    redCriticalAllHaveOwner: false,
    redCriticalAnyHasAction: false,
    domainsWithSession: new Set(),
    domainsWithResolvedSession: new Set(),
    highSeverityFindings: 0,
    externalCallsCount: 0,
    connectedKpiSources: new Set(),
    kpiMetricLatestDays: new Map(),
  };
}

// ============================================================
// Apply rules
// ============================================================

export type AutoStatus = Status | "unknown";

export function deriveAutoStatus(
  rule: AutoRule,
  facts: WorkspaceFacts,
): AutoStatus {
  switch (rule.kind) {
    case "workspace_exists":
      return facts.orgId ? "done" : "not_started";

    case "respondents_at_least":
      if (facts.totalRespondents >= rule.n) return "done";
      if (facts.totalRespondents > 0) return "in_progress";
      return "not_started";

    case "diagnosis_complete":
      return facts.hasAnyResponse ? "done" : "not_started";

    case "domain_responded":
      return facts.respondedDomains.has(rule.code) ? "done" : "not_started";

    case "evidence_recorded_for":
      return facts.recentEvidenceDomains.has(rule.code)
        ? "done"
        : facts.respondedDomains.has(rule.code)
          ? "in_progress"
          : "not_started";

    case "any_action_with_owner_for_critical_red":
      return facts.redCriticalAnyHasAction && facts.redCriticalAllHaveOwner
        ? "done"
        : facts.redCriticalAnyHasAction
          ? "in_progress"
          : "not_started";

    case "all_red_critical_have_action":
      return facts.redCriticalAllHaveOwner && facts.redCriticalAnyHasAction
        ? "done"
        : "not_started";

    case "no_overdue_actions":
      return facts.hasOverdue ? "in_progress" : "done";

    case "actions_verified_at_least":
      return facts.verifiedActionsCount >= rule.n ? "done" : "in_progress";

    case "coach_session_for":
      return facts.domainsWithSession.has(rule.code) ? "done" : "not_started";

    case "coach_session_resolved_for":
      return facts.domainsWithResolvedSession.has(rule.code)
        ? "done"
        : facts.domainsWithSession.has(rule.code)
          ? "in_progress"
          : "not_started";

    case "external_expert_called_if_severity_4":
      // Done if either no severity-4 findings OR external call has happened
      if (facts.highSeverityFindings === 0) return "done";
      return facts.externalCallsCount > 0 ? "done" : "scheduled";

    case "kpi_source_connected":
      return facts.connectedKpiSources.has(rule.source) ? "done" : "not_started";

    case "kpi_recent_within_days": {
      const days = facts.kpiMetricLatestDays.get(rule.metric);
      if (days === undefined) return "not_started";
      return days <= rule.days ? "done" : "in_progress";
    }

    case "diagnosis_within_days": {
      if (!facts.latestDiagnosisAt) return "not_started";
      const days = Math.floor(
        (Date.now() - new Date(facts.latestDiagnosisAt).getTime()) /
          (24 * 60 * 60 * 1000),
      );
      return days <= rule.days ? "done" : "scheduled";
    }

    case "manual_only":
      return "unknown";
  }
}

export function deriveAllStatuses(
  tasks: Task[],
  facts: WorkspaceFacts,
): Map<string, AutoStatus> {
  const m = new Map<string, AutoStatus>();
  for (const t of tasks) m.set(t.id, deriveAutoStatus(t.auto, facts));
  return m;
}

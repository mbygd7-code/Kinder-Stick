import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";
import { SignalsClient } from "./_signals";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

export interface KpiSnapshot {
  id: string;
  source: string;
  metric_key: string;
  value: number;
  captured_at: string;
  raw: Record<string, unknown> | null;
  anomaly_flag: boolean;
  anomaly_reason: string | null;
}

export interface SignalEvent {
  id: string;
  kind: string;
  domain_code: string | null;
  narrative: string;
  severity: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface MetricDefinition {
  id: string;
  source: string;
  metric_key: string;
  mapped_sub_item_code: string | null;
  threshold_rule: Record<string, unknown> | null;
  cadence: string | null;
}

export default async function SignalsPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();

  const sb = supabaseAdmin();
  const org = await resolveOrgWithBackfill(sb, workspace);

  let snapshots: KpiSnapshot[] = [];
  let events: SignalEvent[] = [];
  if (org) {
    const [snapRes, evRes] = await Promise.all([
      sb
        .from("kpi_snapshots")
        .select(
          "id, source, metric_key, value, captured_at, raw, anomaly_flag, anomaly_reason",
        )
        .eq("org_id", org.id)
        .order("captured_at", { ascending: false })
        .limit(50),
      sb
        .from("signal_events")
        .select(
          "id, kind, domain_code, narrative, severity, metadata, created_at",
        )
        .eq("org_id", org.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    snapshots = (snapRes.data ?? []) as KpiSnapshot[];
    events = (evRes.data ?? []) as SignalEvent[];
  }

  const { data: metricDefs } = await sb
    .from("metric_definitions")
    .select("id, source, metric_key, mapped_sub_item_code, threshold_rule, cadence")
    .eq("active", true)
    .order("source");

  return (
    <SignalsClient
      workspace={workspace}
      orgFound={!!org}
      snapshots={snapshots}
      events={events}
      metricDefs={(metricDefs ?? []) as MetricDefinition[]}
      showMockInjector={process.env.NODE_ENV !== "production"}
    />
  );
}

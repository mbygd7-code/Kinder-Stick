import { notFound } from "next/navigation";
import { loadFramework } from "@/lib/framework/loader";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CoachClient, type SessionBootstrap } from "./_coach";

interface Props {
  params: Promise<{ workspace: string; domain: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const DOMAIN_PATTERN = /^A\d{1,2}$/;

export default async function CoachPage({ params }: Props) {
  const { workspace, domain } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();
  if (!DOMAIN_PATTERN.test(domain)) notFound();

  const framework = loadFramework();
  const domainDef = framework.domains.find((d) => d.code === domain);
  if (!domainDef) notFound();

  // Find latest active session for (workspace org, domain)
  const sb = supabaseAdmin();
  const { data: org } = await sb
    .from("organizations")
    .select("id")
    .eq("name", workspace)
    .maybeSingle();

  let bootstrap: SessionBootstrap | null = null;

  if (org) {
    const { data: sessionRow } = await sb
      .from("agent_sessions")
      .select("id, state, severity, opened_at, summary")
      .eq("org_id", org.id)
      .eq("domain_code", domain)
      .not("state", "in", '("resolved","abandoned")')
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionRow) {
      const [{ data: messages }, { data: actions }] = await Promise.all([
        sb
          .from("agent_messages")
          .select("id, role, content, created_at")
          .eq("session_id", sessionRow.id)
          .neq("role", "system")
          .order("created_at", { ascending: true }),
        sb
          .from("coaching_actions")
          .select(
            "id, title, smart_payload, owner_role, deadline, status, verification_metric, created_at",
          )
          .eq("session_id", sessionRow.id)
          .order("created_at", { ascending: true }),
      ]);

      bootstrap = {
        session_id: sessionRow.id,
        state: sessionRow.state,
        severity: sessionRow.severity,
        summary: sessionRow.summary,
        opened_at: sessionRow.opened_at,
        messages: (messages ?? []) as SessionBootstrap["messages"],
        actions: (actions ?? []) as SessionBootstrap["actions"],
      };
    }
  }

  return (
    <CoachClient
      workspace={workspace}
      domain={domainDef}
      bootstrap={bootstrap}
    />
  );
}

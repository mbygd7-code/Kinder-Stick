import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ActionsBoard, type ActionRow } from "./_actions-board";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

export default async function ActionsPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();

  const sb = supabaseAdmin();
  const { data: org } = await sb
    .from("organizations")
    .select("id, name")
    .eq("name", workspace)
    .maybeSingle();

  let actions: ActionRow[] = [];
  if (org) {
    const { data } = await sb
      .from("coaching_actions")
      .select(
        "id, session_id, title, smart_payload, owner_role, deadline, status, verification_metric, verified_at, created_at, updated_at",
      )
      .eq("org_id", org.id)
      .order("deadline", { ascending: true });
    actions = (data ?? []) as ActionRow[];
  }

  // Lookup domain code per session for richer cards
  let sessionMap = new Map<string, { domain_code: string }>();
  if (actions.length > 0) {
    const sessionIds = Array.from(new Set(actions.map((a) => a.session_id)));
    const { data: sessions } = await sb
      .from("agent_sessions")
      .select("id, domain_code")
      .in("id", sessionIds);
    sessionMap = new Map(
      (sessions ?? []).map((s) => [s.id, { domain_code: s.domain_code }]),
    );
  }

  return (
    <ActionsBoard
      workspace={workspace}
      actions={actions}
      sessions={Object.fromEntries(sessionMap)}
    />
  );
}

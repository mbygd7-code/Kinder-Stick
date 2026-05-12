import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

interface MembershipRow {
  role: string;
  joined_at: string;
  organization: {
    id: string;
    name: string;
    stage: string | null;
    created_at: string;
  } | null;
}

interface WorkspaceCard {
  org_id: string;
  workspace_id: string;
  role: string;
  stage: string | null;
  joined_at: string;
  pending_findings: number;
  active_actions: number;
  overdue_actions: number;
  last_diagnosis: string | null;
}

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login?next=/me");
  }

  const sb = supabaseAdmin();

  // 1) memberships joined to organizations
  const { data: members } = await sb
    .from("org_members")
    .select(
      "role, joined_at, organization:organizations!inner(id, name, stage, created_at)",
    )
    .eq("user_id", user.id);

  const memberships = (members ?? []) as unknown as MembershipRow[];

  if (memberships.length === 0) {
    return <EmptyView email={user.email} />;
  }

  // 2) for each org, gather pending findings + actions + last diagnosis
  const orgIds = memberships
    .map((m) => m.organization?.id)
    .filter((x): x is string => !!x);

  const [pendingRes, actionsRes, diagRes] = await Promise.all([
    sb
      .from("agent_sessions")
      .select("org_id, severity")
      .in("org_id", orgIds)
      .in("state", ["action_planning", "analyzing", "diagnosing", "evidence_request"])
      .eq("trigger_kind", "proactive"),
    sb
      .from("coaching_actions")
      .select("org_id, status, deadline")
      .in("org_id", orgIds),
    sb
      .from("diagnosis_responses")
      .select("workspace_id, completed_at")
      .in("workspace_id", memberships.map((m) => m.organization?.name ?? "")),
  ]);

  const pendingByOrg = new Map<string, number>();
  for (const r of (pendingRes.data ?? []) as Array<{ org_id: string }>) {
    pendingByOrg.set(r.org_id, (pendingByOrg.get(r.org_id) ?? 0) + 1);
  }
  const activeByOrg = new Map<string, number>();
  const overdueByOrg = new Map<string, number>();
  const now = Date.now();
  for (const a of (actionsRes.data ?? []) as Array<{
    org_id: string;
    status: string;
    deadline: string | null;
  }>) {
    if (a.status === "accepted" || a.status === "in_progress") {
      activeByOrg.set(a.org_id, (activeByOrg.get(a.org_id) ?? 0) + 1);
      if (a.deadline && new Date(a.deadline).getTime() < now) {
        overdueByOrg.set(a.org_id, (overdueByOrg.get(a.org_id) ?? 0) + 1);
      }
    }
  }
  const lastDiagByWs = new Map<string, string>();
  for (const d of (diagRes.data ?? []) as Array<{
    workspace_id: string;
    completed_at: string;
  }>) {
    const cur = lastDiagByWs.get(d.workspace_id);
    if (!cur || cur < d.completed_at) {
      lastDiagByWs.set(d.workspace_id, d.completed_at);
    }
  }

  const cards: WorkspaceCard[] = memberships
    .filter((m) => m.organization)
    .map((m) => ({
      org_id: m.organization!.id,
      workspace_id: m.organization!.name,
      role: m.role,
      stage: m.organization!.stage,
      joined_at: m.joined_at,
      pending_findings: pendingByOrg.get(m.organization!.id) ?? 0,
      active_actions: activeByOrg.get(m.organization!.id) ?? 0,
      overdue_actions: overdueByOrg.get(m.organization!.id) ?? 0,
      last_diagnosis: lastDiagByWs.get(m.organization!.name) ?? null,
    }));

  return (
    <main className="min-h-dvh w-full pb-20">
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6 flex-wrap">
          <div className="flex items-baseline gap-3">
            <span className="kicker">Kinder Stick OS</span>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">{user.email}</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/diag" className="label-mono hover:text-ink">
              Domain Map
            </a>
            <a href="/auth/logout" className="label-mono hover:text-ink">
              logout
            </a>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-3">No. 13 · 내 워크스페이스</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          My{" "}
          <span className="text-accent italic font-display">Workspaces</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          소속된 {cards.length}개 워크스페이스의 핵심 시그널을 한 화면에서.
          새 워크스페이스를 만들려면 <a href="/diag" className="underline hover:text-accent">/diag</a> 에서 ID 입력 후 진단을 시작하고, 홈 페이지에서 "내 워크스페이스로 저장" 버튼.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => (
          <a
            key={c.org_id}
            href={`/diag/${c.workspace_id}/home`}
            className="area-card hover:bg-paper-deep/30 block transition-colors"
          >
            <header className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="kicker">
                {c.role} · {c.stage ?? "—"}
              </span>
              {c.overdue_actions > 0 ? (
                <span className="tag tag-red">overdue {c.overdue_actions}</span>
              ) : c.pending_findings > 0 ? (
                <span className="tag tag-accent">
                  🤖 pending {c.pending_findings}
                </span>
              ) : (
                <span className="tag tag-green">on track</span>
              )}
            </header>
            <h2 className="mt-2 font-display text-3xl leading-tight">
              {c.workspace_id}
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-2 label-mono">
              <div>
                <p>Pending</p>
                <p
                  className={`font-display text-xl ${
                    c.pending_findings > 0 ? "!text-accent" : "!text-ink"
                  }`}
                >
                  {c.pending_findings}
                </p>
              </div>
              <div>
                <p>Active</p>
                <p
                  className={`font-display text-xl ${
                    c.overdue_actions > 0 ? "!text-signal-red" : "!text-ink"
                  }`}
                >
                  {c.active_actions}
                </p>
              </div>
              <div>
                <p>Last diag</p>
                <p className="font-mono text-xs mt-1">
                  {c.last_diagnosis
                    ? c.last_diagnosis.slice(0, 10)
                    : "—"}
                </p>
              </div>
            </div>
          </a>
        ))}
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a href="/diag" className="label-mono hover:text-ink">
          → Domain Map
        </a>
        <p className="label-mono">{ISSUE_DATE} · me v1</p>
      </footer>
    </main>
  );
}

function EmptyView({ email }: { email: string | null }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">아직 워크스페이스 없음</p>
        <h1 className="font-display text-3xl">
          첫 워크스페이스를 시작하거나 claim 하세요
        </h1>
        <p className="mt-3 text-ink-soft text-sm">
          로그인 계정: <span className="font-mono">{email}</span>
        </p>
        <div className="mt-6 flex justify-center gap-3 flex-wrap">
          <a href="/diag" className="btn-primary">
            <span className="font-mono text-xs">→</span>
            Domain Map / 시작
          </a>
          <a href="/auth/logout" className="btn-secondary">
            logout
          </a>
        </div>
      </div>
    </main>
  );
}

import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";
import { getCurrentUser } from "@/lib/supabase/auth";
import { MembersClient } from "./_members-client";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ISSUE_DATE = new Date().toISOString().slice(0, 10);

export interface MemberRow {
  user_id: string;
  role: string;
  joined_at: string;
  email?: string | null;
  is_self: boolean;
}

export default async function MembersPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();

  const sb = supabaseAdmin();
  const orgBase = await resolveOrgWithBackfill(sb, workspace);

  if (!orgBase) {
    return <UnknownWorkspaceView workspace={workspace} />;
  }
  // Members page needs settings (pending_invites). Fetch separately.
  const { data: orgFull } = await sb
    .from("organizations")
    .select("id, name, stage, settings")
    .eq("id", orgBase.id)
    .maybeSingle();
  const org = orgFull ?? { ...orgBase, settings: null };

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return <UnauthedView workspace={workspace} />;
  }

  // Verify caller is a member
  const { data: caller } = await sb
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (!caller) {
    return <NotMemberView workspace={workspace} />;
  }

  const callerRole = caller.role as string;

  const { data: rawMembers } = await sb
    .from("org_members")
    .select("user_id, role, joined_at")
    .eq("org_id", org.id)
    .order("joined_at", { ascending: true });

  // Try to enrich with email (auth.admin)
  const members: MemberRow[] = [];
  for (const m of (rawMembers ?? []) as Array<{
    user_id: string;
    role: string;
    joined_at: string;
  }>) {
    let email: string | null = null;
    try {
      const { data } = await sb.auth.admin.getUserById(m.user_id);
      email = data.user?.email ?? null;
    } catch {
      // ignore
    }
    members.push({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      email,
      is_self: m.user_id === currentUser.id,
    });
  }

  const settings = (org.settings as Record<string, unknown> | null) ?? {};
  const pendingInvites = Array.isArray(settings.pending_invites)
    ? (settings.pending_invites as string[])
    : [];

  return (
    <main className="min-h-dvh w-full pb-20">
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap">
            <a
              href={`/diag/${workspace}/dashboard`}
              className="kicker hover:text-ink"
            >
              ← Dashboard
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              {workspace} · members
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/me" className="label-mono hover:text-ink">
              /me ({currentUser.email?.split("@")[0]})
            </a>
            <span className="label-mono">MEMBERS · {callerRole.toUpperCase()}</span>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-3">No. 14 · Workspace members</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Team
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          현재 멤버 {members.length}명, 대기 중 초대 {pendingInvites.length}건.
          owner는 멤버를 초대·역할 변경·제거할 수 있습니다. 초대된 사용자가 매직링크로
          로그인하면 자동으로 contributor 등록됩니다.
        </p>
      </section>

      <MembersClient
        workspace={workspace}
        callerRole={callerRole}
        members={members}
        pendingInvites={pendingInvites}
      />

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a
          href={`/diag/${workspace}/dashboard`}
          className="label-mono hover:text-ink"
        >
          ← back to dashboard
        </a>
        <p className="label-mono">{ISSUE_DATE} · members v1</p>
      </footer>
    </main>
  );
}

function UnauthedView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">Sign in required</p>
        <h1 className="font-display text-3xl">
          멤버 페이지는 로그인 후 접근할 수 있습니다
        </h1>
        <a
          href={`/auth/login?next=${encodeURIComponent(`/diag/${workspace}/members`)}`}
          className="btn-primary mt-6 inline-flex"
        >
          Sign in <span className="font-mono text-xs">→</span>
        </a>
      </div>
    </main>
  );
}

function NotMemberView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2 !text-signal-amber">Not a member</p>
        <h1 className="font-display text-3xl">
          이 워크스페이스 멤버가 아닙니다
        </h1>
        <p className="mt-3 text-ink-soft text-sm">
          dashboard 에서 "Claim ownership" 으로 가입할 수 있습니다.
        </p>
        <a
          href={`/diag/${workspace}/dashboard`}
          className="btn-secondary mt-6 inline-flex"
        >
          ← Dashboard
        </a>
      </div>
    </main>
  );
}

function UnknownWorkspaceView({ workspace }: { workspace: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="kicker mb-2">Workspace not found</p>
        <h1 className="font-display text-3xl">
          <span className="font-mono">{workspace}</span> 워크스페이스가 없습니다
        </h1>
        <a href="/diag" className="btn-secondary mt-6 inline-flex">
          ← Domain Map
        </a>
      </div>
    </main>
  );
}

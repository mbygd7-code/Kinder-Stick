import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

export default async function WorklistResolverPage() {
  const user = await getCurrentUser();

  if (!user) {
    return <NoUserView />;
  }

  // Find user's most recently active workspace
  const sb = supabaseAdmin();
  const { data: members } = await sb
    .from("org_members")
    .select(
      "joined_at, organization:organizations!inner(name, created_at)",
    )
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false })
    .limit(1);

  const ws = (members?.[0] as
    | { organization?: { name?: string } | null }
    | undefined)?.organization?.name;

  if (ws) {
    redirect(`/diag/${ws}/worklist`);
  }

  return <NoWorkspaceView email={user.email} />;
}

function NoUserView() {
  return (
    <main className="min-h-dvh w-full">
      <section className="max-w-3xl mx-auto px-6 sm:px-10 pt-20 pb-10">
        <p className="kicker mb-3">워크리스트</p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] tracking-tight break-keep">
          먼저 워크스페이스를 시작하세요
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink-soft">
          워크리스트는 워크스페이스의 진단·코칭 데이터를 기반으로 자동
          채워집니다. 진단을 시작하면 팀별 업무가 즉시 나타납니다.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="/diag" className="btn-primary">
            진단 시작 <span className="font-mono text-xs">→</span>
          </a>
          <a href="/auth/login?next=/worklist" className="btn-secondary">
            <span className="font-mono text-xs">→</span>
            로그인
          </a>
        </div>
      </section>
      <footer className="max-w-3xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 label-mono">
        {ISSUE_DATE}
      </footer>
    </main>
  );
}

function NoWorkspaceView({ email }: { email: string | null }) {
  return (
    <main className="min-h-dvh w-full">
      <section className="max-w-3xl mx-auto px-6 sm:px-10 pt-20 pb-10">
        <p className="kicker mb-3">워크리스트</p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] tracking-tight break-keep">
          아직 참여 중인 워크스페이스가 없습니다
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink-soft">
          진단을 새로 시작하거나, 다른 사람이 만든 워크스페이스 ID를 알고
          있다면 그 ID로 들어가 ‘Claim ownership’을 눌러 본인 계정에
          연결하세요.
        </p>
        <p className="mt-3 label-mono">로그인 계정 · {email}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="/diag" className="btn-primary">
            진단 시작 <span className="font-mono text-xs">→</span>
          </a>
          <a href="/me" className="btn-secondary">
            <span className="font-mono text-xs">→</span>
            내 워크스페이스
          </a>
        </div>
      </section>
      <footer className="max-w-3xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 label-mono">
        {ISSUE_DATE}
      </footer>
    </main>
  );
}

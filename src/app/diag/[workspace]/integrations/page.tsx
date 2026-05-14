import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgWithBackfill } from "@/lib/org";
import { integrationsStatus } from "@/lib/integrations/dispatch";
import { SurveysSection } from "./_surveys-section";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const ISSUE_DATE = new Date().toISOString().slice(0, 10);

interface RecentDispatch {
  id: string;
  title: string;
  status: string;
  created_at: string;
  dispatched: {
    notion: { ok: boolean; mock: boolean; error?: string; external_url?: string } | null;
    slack: { ok: boolean; mock: boolean; error?: string } | null;
  };
}

export default async function IntegrationsPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) notFound();

  const sb = supabaseAdmin();
  const org = await resolveOrgWithBackfill(sb, workspace);

  const status = integrationsStatus();

  let recent: RecentDispatch[] = [];
  if (org) {
    const { data: actions } = await sb
      .from("coaching_actions")
      .select("id, title, status, smart_payload, created_at")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .limit(15);
    recent = (actions ?? []).map((a) => {
      const integ =
        ((a.smart_payload as Record<string, unknown> | null)?.integrations ??
          {}) as {
          notion?: { ok: boolean; mock: boolean; error?: string; external_url?: string };
          slack?: { ok: boolean; mock: boolean; error?: string };
        };
      return {
        id: a.id,
        title: a.title,
        status: a.status,
        created_at: a.created_at,
        dispatched: {
          notion: integ.notion ?? null,
          slack: integ.slack ?? null,
        },
      };
    });
  }

  return (
    <main className="min-h-dvh w-full pb-20">
      <header className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6 flex-wrap">
          <div className="flex items-baseline gap-3">
            <a
              href={`/diag/${workspace}/home`}
              className="kicker hover:text-ink"
            >
              ← 홈
            </a>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">
              {workspace} / integrations
            </span>
          </div>
          <span className="label-mono">EXTERNAL CHANNELS</span>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-12 pb-6">
        <p className="kicker mb-3">No. 11 · 외부 도구 연동</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Integrations
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-soft">
          채택된 SMART 액션이 자동으로 Notion 데이터베이스 / Slack 채널에
          발행되도록 설정합니다. 키 미설정 시 mock 모드로 동작 — 메타데이터만
          저장되고 외부 호출은 발생하지 않습니다.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
        <SetupCard
          name="Notion"
          configured={status.notion.configured}
          envVars={["NOTION_TOKEN", "NOTION_DATABASE_ID"]}
          docs={[
            "1. https://www.notion.so/my-integrations 에서 internal integration 생성",
            "2. Internal Integration Token (secret_...)을 NOTION_TOKEN 으로 .env.local 에 저장",
            "3. 타겟 Notion 데이터베이스 우상단 ··· → Connections → 위 integration 추가",
            "4. 데이터베이스 URL 의 ?v=... 직전 32자 UUID를 NOTION_DATABASE_ID 로 저장",
            "5. 데이터베이스 컬럼: Title(title) / Status(select) / Owner(rich_text) / Deadline(date) / Source(rich_text) / Action ID(rich_text) / Domain(rich_text) / Verify Metric(rich_text)",
          ]}
        />
        <SetupCard
          name="Slack"
          configured={status.slack.configured}
          envVars={["SLACK_WEBHOOK_URL"]}
          docs={[
            "1. https://api.slack.com/messaging/webhooks 에서 incoming webhook 생성",
            "2. 발급된 https://hooks.slack.com/services/... URL 을 SLACK_WEBHOOK_URL 에 저장",
            "3. 워크스페이스 + 채널 선택 (예: #ops-alerts)",
            "4. dev server 재시작 — 다음 채택 액션부터 자동 발송",
          ]}
        />
      </section>

      {/* 자체 NPS·PMF 설문 관리 — Notion/Slack 과 별개 섹션 */}
      <SurveysSection workspace={workspace} />

      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Recent dispatch log ({recent.length})
          </span>
        </div>
      </div>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 overflow-x-auto">
        {recent.length === 0 ? (
          <div className="note-box">
            아직 채택된 액션이 없습니다. 코치 페이지에서 SMART 액션을 채택하면
            자동으로 dispatch 가 시도됩니다.
          </div>
        ) : (
          <table className="w-full text-sm border border-ink">
            <thead className="bg-paper-deep border-b border-ink">
              <tr>
                <Th>Action</Th>
                <Th className="text-center">Notion</Th>
                <Th className="text-center">Slack</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b border-ink-soft/30">
                  <Td>
                    <p className="font-mono text-xs">#{r.id.slice(0, 8)}</p>
                    <p className="leading-snug">{r.title.slice(0, 100)}</p>
                  </Td>
                  <Td className="text-center">
                    <DispatchCell d={r.dispatched.notion} />
                  </Td>
                  <Td className="text-center">
                    <DispatchCell d={r.dispatched.slack} />
                  </Td>
                  <Td className="font-mono text-xs whitespace-nowrap">
                    {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="max-w-6xl mx-auto px-6 sm:px-10 mt-16 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <a
          href={`/diag/${workspace}/home`}
          className="label-mono hover:text-ink"
        >
          ← 홈으로
        </a>
        <p className="label-mono">{ISSUE_DATE} · integrations v1</p>
      </footer>
    </main>
  );
}

function SetupCard({
  name,
  configured,
  envVars,
  docs,
}: {
  name: string;
  configured: boolean;
  envVars: string[];
  docs: string[];
}) {
  return (
    <article
      className={`area-card ${
        configured ? "!border-signal-green bg-soft-green/30" : ""
      }`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">{name}</h2>
        <span
          className={`tag ${configured ? "tag-green" : ""}`}
        >
          {configured ? "CONFIGURED" : "MOCK MODE"}
        </span>
      </header>
      <p className="mt-2 label-mono">
        env vars: {envVars.map((e) => `${e}`).join(", ")}
      </p>
      <details className="mt-4">
        <summary className="kicker cursor-pointer hover:text-ink">
          setup steps →
        </summary>
        <ol className="mt-2 space-y-1 text-sm leading-relaxed">
          {docs.map((d, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono text-xs text-ink-soft">{i + 1}.</span>
              <span>{d}</span>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

function DispatchCell({
  d,
}: {
  d: RecentDispatch["dispatched"]["notion"] | RecentDispatch["dispatched"]["slack"];
}) {
  if (!d) return <span className="label-mono">—</span>;
  if (!d.ok) {
    return (
      <span className="tag tag-red" title={d.error}>
        FAILED
      </span>
    );
  }
  if (d.mock) {
    return <span className="tag">mock</span>;
  }
  const url = (d as { external_url?: string }).external_url;
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="tag tag-green"
      >
        OK →
      </a>
    );
  }
  return <span className="tag tag-green">OK</span>;
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-3 py-3 label-mono font-semibold !text-ink ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

import { supabaseAnon } from "@/lib/supabase/server";
import { anthropic } from "@/lib/anthropic";

type Check = { ok: boolean; msg: string; sub?: string };

async function checkSupabase(): Promise<Check> {
  try {
    const sb = supabaseAnon();
    const { error, count } = await sb
      .from("diagnosis_responses")
      .select("*", { count: "exact", head: true });
    if (error) {
      if (error.code === "42P01") {
        return {
          ok: false,
          msg: "diagnosis_responses 테이블이 없습니다",
          sub: "framework/schema_v2.sql 을 Supabase SQL Editor에서 실행하세요.",
        };
      }
      return { ok: false, msg: `${error.code ?? "?"}: ${error.message}` };
    }
    return {
      ok: true,
      msg: "연결 OK",
      sub: `diagnosis_responses · ${count ?? 0} rows`,
    };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

async function checkAnthropic(): Promise<Check> {
  try {
    const r = await anthropic().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 30,
      messages: [
        { role: "user", content: "딱 한 단어로 'OK'라고만 답하세요." },
      ],
    });
    const text = r.content
      .reduce(
        (acc, b) => acc + (b.type === "text" ? b.text : ""),
        "",
      )
      .trim();
    return {
      ok: true,
      msg: `응답 "${text}"`,
      sub: `claude-haiku-4-5 · ${r.usage.input_tokens} in / ${r.usage.output_tokens} out`,
    };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

export default async function AdminHealthPage() {
  const [sb, an] = await Promise.all([checkSupabase(), checkAnthropic()]);
  const allOk = sb.ok && an.ok;

  return (
    <main className="min-h-dvh w-full">
      <header className="border-b-2 border-ink">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 py-5 flex items-baseline justify-between gap-6 flex-wrap">
          <span className="kicker">Admin · Health Check</span>
          <span className="label-mono">{ISSUE_DATE}</span>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-10 pb-6">
        <p className="kicker mb-3">Smoke Test · 환경 점검</p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight">
          System Health
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-soft">
          .env.local의 키 4개와 외부 의존성이 작동하는지 검증합니다. 일반
          사용자 페이지가 아닌 운영자 점검용 페이지입니다.
        </p>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className={`tag ${allOk ? "tag-green" : "tag-accent"}`}>
            {allOk ? "All systems go" : "Action required"}
          </span>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        <CheckCard num="01" label="Supabase" check={sb} />
        <CheckCard num="02" label="Anthropic Claude" check={an} />
      </section>

      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-10 flex flex-wrap gap-3">
        <a href="/diag" className="btn-primary">
          진단 시작 페이지로
          <span className="font-mono text-xs">→</span>
        </a>
        <a href="/scoring-test" className="btn-secondary">
          <span className="font-mono text-xs">→</span>
          Scoring engine test
        </a>
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary"
        >
          <span className="font-mono text-xs">↗</span>
          Supabase Dashboard
        </a>
      </section>

      <footer className="max-w-5xl mx-auto px-6 sm:px-10 mt-16 pb-12 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">/admin/health · ops use</p>
        <p className="label-mono">{ISSUE_DATE}</p>
      </footer>
    </main>
  );
}

function CheckCard({
  num,
  label,
  check,
}: {
  num: string;
  label: string;
  check: Check;
}) {
  const accentClass = check.ok ? "text-signal-green" : "text-signal-red";
  return (
    <article
      className={`area-card flex flex-col ${
        check.ok ? "" : "!border-signal-red bg-soft-red/40"
      }`}
    >
      <header className="flex items-baseline justify-between gap-4">
        <span className="kicker">
          <span className="section-num">No. </span>
          {num}
        </span>
        <span
          className={`tag ${check.ok ? "tag-green" : "tag-red"}`}
          aria-label={check.ok ? "ok" : "fail"}
        >
          {check.ok ? "PASS" : "FAIL"}
        </span>
      </header>

      <h2 className="mt-4 font-display text-3xl leading-tight">{label}</h2>

      <div className="mt-4 flex items-baseline gap-3">
        <span className={`font-display text-3xl leading-none ${accentClass}`}>
          {check.ok ? "✓" : "✗"}
        </span>
        <p className="font-mono text-sm break-words">{check.msg}</p>
      </div>

      {check.sub ? (
        <p className="mt-2 label-mono break-words">{check.sub}</p>
      ) : null}
    </article>
  );
}

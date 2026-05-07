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
          sub: "Kinder Stick/schema.sql (v1)을 Supabase SQL Editor에서 실행하세요.",
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
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
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

export default async function Home() {
  const [sb, an] = await Promise.all([checkSupabase(), checkAnthropic()]);
  const allOk = sb.ok && an.ok;

  return (
    <main className="min-h-dvh w-full">
      {/* ==================== MASTHEAD ==================== */}
      <header className="border-b-2 border-ink">
        <div className="max-w-5xl mx-auto px-6 sm:px-10 py-6 flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <span className="kicker">Vol. 01 / Issue 00</span>
            <span className="hidden sm:inline label-mono">·</span>
            <span className="hidden sm:inline label-mono">{ISSUE_DATE}</span>
          </div>
          <span className="label-mono">EDITORIAL DRAFT</span>
        </div>
      </header>

      {/* ==================== HERO ==================== */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-14 pb-10">
        <p className="kicker mb-4">Smoke Test · 환경 점검</p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Kinder Stick <span className="text-accent">OS</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
          EdTech 조직의 <strong className="font-semibold text-ink">14-도메인 진단</strong>,{" "}
          Bayesian 실패확률 산출, AI 도메인 코치를 한 화면에서. 이 페이지는
          .env.local에 입력한 키 4개가 실제로 작동하는지 검증합니다.
        </p>

        <div className="mt-6 flex items-center gap-2 flex-wrap">
          <span className="tag tag-filled">Phase 0</span>
          <span className="tag">Foundation</span>
          <span className={`tag ${allOk ? "tag-green" : "tag-accent"}`}>
            {allOk ? "All systems go" : "Action required"}
          </span>
        </div>
      </section>

      {/* ==================== DOTTED RULE ==================== */}
      <div className="max-w-5xl mx-auto px-6 sm:px-10">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Connectivity
          </span>
        </div>
      </div>

      {/* ==================== AREA CARDS ==================== */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <CheckCard num="01" label="Supabase" check={sb} />
        <CheckCard num="02" label="Anthropic Claude" check={an} />
      </section>

      {/* ==================== STATUS BANNER ==================== */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-10">
        <div className={`area-card ${allOk ? "" : "!border-accent"}`}>
          <div className="flex items-start gap-4">
            <span className="font-display text-4xl leading-none text-accent">
              {allOk ? "✓" : "!"}
            </span>
            <div>
              <p className="kicker mb-1">
                {allOk ? "Status / Verified" : "Status / Action required"}
              </p>
              <p className="font-display text-2xl leading-tight">
                {allOk
                  ? "모든 시스템이 작동합니다."
                  : "환경 변수를 다시 확인하세요."}
              </p>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                {allOk ? (
                  <>
                    다음 단계: Supabase SQL Editor에서{" "}
                    <code className="font-mono text-xs px-1.5 py-0.5 bg-paper-deep border border-ink-soft">
                      framework/schema_v2.sql
                    </code>
                    을 실행해 14-도메인 테이블을 생성하세요. 끝나면{" "}
                    <code className="font-mono text-xs px-1.5 py-0.5 bg-paper-deep border border-ink-soft">
                      /scoring-test
                    </code>{" "}
                    페이지에서 점수 산식이 정상 동작하는지 확인할 수 있습니다.
                  </>
                ) : (
                  <>
                    빨간 카드의 메시지를 보고{" "}
                    <code className="font-mono text-xs px-1.5 py-0.5 bg-paper-deep border border-ink-soft">
                      .env.local
                    </code>
                    의 해당 키를 다시 확인하세요. 저장 후 새로고침하면 즉시
                    반영됩니다.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== SECONDARY NAV ==================== */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 mt-10 flex flex-wrap gap-3">
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

      {/* ==================== FOOTER ==================== */}
      <footer className="max-w-5xl mx-auto px-6 sm:px-10 mt-20 pb-12 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">
          Set in Fraunces, Pretendard &amp; JetBrains Mono.
        </p>
        <p className="label-mono">
          Build · {ISSUE_DATE} · phase 0 / smoke test
        </p>
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

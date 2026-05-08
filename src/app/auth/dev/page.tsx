"use client";

import { useState } from "react";

export default function DevLoginPage() {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setError(null);
    setLink(null);
    setLoading(true);
    try {
      const r = await fetch(
        `/api/admin/dev-link?email=${encodeURIComponent(email)}`,
      );
      const json = (await r.json()) as {
        link?: string;
        error?: string;
        detail?: string;
      };
      if (!r.ok || !json.link) {
        setError(json.detail ?? json.error ?? `HTTP ${r.status}`);
        return;
      }
      setLink(json.link);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md w-full">
        <header className="mb-6">
          <p className="kicker mb-2">Dev only · bypass email</p>
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight">
            Magic link <span className="italic font-light">generator</span>
          </h1>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed">
            Supabase 이메일 레이트리밋을 우회합니다. 메일을 보내지 않고
            매직링크 URL만 발급하므로, 개발 중 반복 로그인 테스트에 사용하세요.
            <br />
            <span className="text-signal-red font-medium">
              운영 빌드(NODE_ENV=production)에선 자동으로 비활성화됩니다.
            </span>
          </p>
        </header>

        <form
          className="area-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !loading) generate();
          }}
        >
          <p className="kicker mb-3">Generate</p>
          <label className="label-mono mb-1 block" htmlFor="dev-email">
            이메일 주소
          </label>
          <input
            id="dev-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="evidence-input"
            placeholder="you@example.com"
            required
          />
          <p className="mt-1 label-mono">
            존재하지 않는 사용자면 자동으로 생성됩니다.
          </p>
          <div className="mt-4 dotted-rule pt-4 flex flex-wrap gap-3 items-center justify-between">
            <a href="/auth/login" className="label-mono hover:text-ink">
              ← 일반 로그인으로
            </a>
            <button
              type="submit"
              disabled={!valid || loading}
              className="btn-primary disabled:opacity-50"
            >
              {loading ? "생성 중…" : "매직링크 발급"}
              <span className="font-mono text-xs">→</span>
            </button>
          </div>
          {error ? (
            <p className="mt-3 font-mono text-xs text-signal-red">⚠ {error}</p>
          ) : null}
        </form>

        {link ? (
          <div className="mt-5 area-card !border-signal-green bg-soft-green/30">
            <p className="kicker !text-signal-green mb-2">Ready</p>
            <p className="text-sm leading-relaxed mb-3">
              아래 링크를 클릭하면 즉시 로그인됩니다 (이메일 발송 없음).
            </p>
            <a
              href={link}
              className="btn-primary w-full justify-center mb-3"
            >
              로그인하러 가기
              <span className="font-mono text-xs">→</span>
            </a>
            <p className="label-mono mb-1">URL:</p>
            <p className="font-mono text-[10px] break-all bg-paper-deep border border-ink-soft/30 p-2 select-all">
              {link}
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

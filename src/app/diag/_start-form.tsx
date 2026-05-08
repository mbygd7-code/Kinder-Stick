"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function defaultWorkspace(): string {
  const now = new Date();
  const y = now.getFullYear();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `kb-${y}-q${q}`;
}

export default function StartDiagnosisForm() {
  const [ws, setWs] = useState(defaultWorkspace());
  const router = useRouter();

  const valid = /^[a-zA-Z0-9_-]{3,50}$/.test(ws);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/diag/${ws}/dashboard`);
      }}
    >
      <label
        className="label-mono mb-2 block"
        htmlFor="workspace-input"
      >
        진단 ID (워크스페이스)
      </label>
      <div className="flex flex-col sm:flex-row sm:gap-0 gap-2">
        <input
          id="workspace-input"
          type="text"
          value={ws}
          onChange={(e) => setWs(e.target.value)}
          className="flex-1 min-w-0 px-4 h-12 font-mono text-base bg-paper border-2 border-ink focus:outline-none focus:border-accent transition-colors"
          placeholder="kb-2026-q2"
          pattern="^[a-zA-Z0-9_-]{3,50}$"
          autoComplete="off"
          aria-invalid={!valid}
          aria-describedby="workspace-help"
        />
        <button
          type="submit"
          disabled={!valid}
          className={`h-12 px-6 sm:px-7 font-semibold tracking-tight border-2 border-ink sm:border-l-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors ${
            valid
              ? "bg-ink text-paper hover:bg-accent hover:border-accent cursor-pointer"
              : "bg-paper-deep text-ink-soft cursor-not-allowed"
          }`}
        >
          시작하기
          <span className="font-mono text-xs">→</span>
        </button>
      </div>
      <p id="workspace-help" className="mt-2 label-mono leading-relaxed">
        영문·숫자·_·- 만, 3–50자. 같은 ID로 여러 명이 응답하면 자동 합산됩니다.
      </p>
    </form>
  );
}

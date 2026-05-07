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
      className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end"
    >
      <div className="flex-1">
        <label className="label-mono mb-1 block" htmlFor="workspace-input">
          Workspace ID
        </label>
        <input
          id="workspace-input"
          type="text"
          value={ws}
          onChange={(e) => setWs(e.target.value)}
          className="evidence-input"
          placeholder="kb-2026-q2"
          pattern="^[a-zA-Z0-9_-]{3,50}$"
          autoComplete="off"
        />
        <p className="mt-1 label-mono">
          영문·숫자·_·- 만, 3–50자. 같은 ID면 여러 명이 합산됩니다.
        </p>
      </div>
      <button
        type="submit"
        className="btn-primary"
        disabled={!valid}
      >
        Open workspace
        <span className="font-mono text-xs">→</span>
      </button>
    </form>
  );
}

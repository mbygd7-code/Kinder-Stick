"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  workspace: string;
  authed: boolean;
  alreadyMember: boolean;
  role: string | null;
  email: string | null;
}

export function ClaimButton({
  workspace,
  authed,
  alreadyMember,
  role,
  email,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function claim() {
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/workspace/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspace_id: workspace }),
        });
        const j = await res.json();
        if (!res.ok || !j.ok) {
          setErr(j.message ?? "claim 실패");
          return;
        }
        setMsg(`role: ${j.role}`);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (!authed) {
    return (
      <a
        href={`/auth/login?next=${encodeURIComponent(`/diag/${workspace}/home`)}`}
        className="tag tag-filled hover:bg-accent hover:border-accent transition-colors"
      >
        로그인하고 워크스페이스 저장
      </a>
    );
  }

  if (alreadyMember) {
    return (
      <span
        className="tag tag-green"
        title={`signed in as ${email ?? "user"}`}
      >
        ✓ {role}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={claim}
      disabled={pending}
      className="tag tag-accent disabled:opacity-50"
      title={`Claim ${workspace} as your workspace`}
    >
      {pending ? "저장 중…" : "내 워크스페이스로 저장"}
      {msg ? ` · ${msg}` : ""}
      {err ? ` · 오류: ${err}` : ""}
    </button>
  );
}

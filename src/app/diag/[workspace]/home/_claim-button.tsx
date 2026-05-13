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

  // [TODO PRODUCTION] 개발 모드: 로그인 안 한 사용자에게 Claim 버튼 자체를 숨김.
  // 인증 복원 시 아래 if(!authed) 블록을 원래 "로그인하고 워크스페이스 저장" 링크로 되돌릴 것.
  if (!authed) {
    return null;
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
      {pending ? "저장 중…" : "내 진단 카드로 저장"}
      {msg ? ` · ${msg}` : ""}
      {err ? ` · 오류: ${err}` : ""}
    </button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MemberRow } from "./page";

interface Props {
  workspace: string;
  callerRole: string;
  members: MemberRow[];
  pendingInvites: string[];
}

const ROLES = ["owner", "admin", "lead", "contributor", "viewer"] as const;

export function MembersClient({
  workspace,
  callerRole,
  members,
  pendingInvites,
}: Props) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");

  const isOwner = callerRole === "owner";
  const canInvite = ["owner", "admin"].includes(callerRole);

  function invite() {
    setError(null);
    startTx(async () => {
      try {
        const res = await fetch(`/api/workspace/${workspace}/invite`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: inviteEmail.trim().toLowerCase() }),
        });
        const j = await res.json();
        if (!res.ok || !j.ok) {
          setError(j.message ?? "초대 실패");
          return;
        }
        setInviteEmail("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function revokeInvite(email: string) {
    setError(null);
    startTx(async () => {
      try {
        const res = await fetch(
          `/api/workspace/${workspace}/invite/${encodeURIComponent(email)}`,
          { method: "DELETE" },
        );
        const j = await res.json();
        if (!res.ok || !j.ok) {
          setError(j.message ?? "취소 실패");
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function changeRole(userId: string, role: string) {
    setError(null);
    startTx(async () => {
      try {
        const res = await fetch(
          `/api/workspace/${workspace}/members/${userId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role }),
          },
        );
        const j = await res.json();
        if (!res.ok || !j.ok) {
          setError(j.message ?? "역할 변경 실패");
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function removeMember(userId: string) {
    if (!confirm("멤버를 제거하시겠습니까?")) return;
    setError(null);
    startTx(async () => {
      try {
        const res = await fetch(
          `/api/workspace/${workspace}/members/${userId}`,
          { method: "DELETE" },
        );
        const j = await res.json();
        if (!res.ok || !j.ok) {
          setError(j.message ?? "제거 실패");
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <>
      {error ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-2">
          <div className="area-card !border-signal-red bg-soft-red/30">
            <p className="kicker !text-signal-red mb-1">Error</p>
            <pre className="font-mono text-xs whitespace-pre-wrap">{error}</pre>
          </div>
        </section>
      ) : null}

      {/* Invite form */}
      {canInvite ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
          <div className="area-card">
            <p className="kicker mb-2">§ Invite by email</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail) && !pending) {
                  invite();
                }
              }}
              className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end"
            >
              <div className="flex-1">
                <label className="label-mono mb-1 block" htmlFor="invite-email">
                  이메일
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="evidence-input"
                  placeholder="teammate@example.com"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="btn-primary disabled:opacity-50"
              >
                {pending ? "처리 중…" : "초대하기"}
                <span className="font-mono text-xs">→</span>
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {/* Pending invites */}
      {pendingInvites.length > 0 ? (
        <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6">
          <div className="area-card">
            <p className="kicker mb-2">
              § Pending invites · {pendingInvites.length}
            </p>
            <ul className="space-y-2">
              {pendingInvites.map((email) => (
                <li
                  key={email}
                  className="flex items-center justify-between gap-3 border-b border-ink-soft/30 pb-2"
                >
                  <span className="font-mono text-sm">{email}</span>
                  {canInvite ? (
                    <button
                      type="button"
                      onClick={() => revokeInvite(email)}
                      disabled={pending}
                      className="text-xs px-2 py-1 border border-ink-soft hover:border-ink disabled:opacity-50"
                    >
                      revoke
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Members table */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-12">
        <div className="divider-ornament">
          <span className="font-mono text-xs uppercase tracking-widest">
            § Members ({members.length})
          </span>
        </div>
      </div>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-6 overflow-x-auto">
        <table className="w-full text-sm border border-ink">
          <thead className="bg-paper-deep border-b border-ink">
            <tr>
              <Th>Email · ID</Th>
              <Th>Joined</Th>
              <Th>Role</Th>
              {isOwner ? <Th className="text-right">Actions</Th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id} className="border-b border-ink-soft/30">
                <Td>
                  <p className="font-mono text-sm">
                    {m.email ?? "(email hidden)"}
                  </p>
                  <p className="label-mono">
                    #{m.user_id.slice(0, 8)}
                    {m.is_self ? " · YOU" : ""}
                  </p>
                </Td>
                <Td className="font-mono text-xs whitespace-nowrap">
                  {m.joined_at.slice(0, 10)}
                </Td>
                <Td>
                  {isOwner && !m.is_self ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.user_id, e.target.value)}
                      disabled={pending}
                      className="evidence-input !py-1 !px-2 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`tag ${
                        m.role === "owner"
                          ? "tag-accent"
                          : m.role === "admin"
                            ? "tag-gold"
                            : "tag-filled"
                      }`}
                    >
                      {m.role}
                    </span>
                  )}
                </Td>
                {isOwner ? (
                  <Td className="text-right">
                    {!m.is_self ? (
                      <button
                        type="button"
                        onClick={() => removeMember(m.user_id)}
                        disabled={pending}
                        className="text-xs px-2 py-1 border border-signal-red text-signal-red hover:bg-soft-red disabled:opacity-50"
                      >
                        remove
                      </button>
                    ) : (
                      <span className="label-mono">— self</span>
                    )}
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-3 label-mono font-semibold !text-ink ${className}`}
    >
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
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

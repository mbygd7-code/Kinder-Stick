"use client";

/**
 * /settings client shell — 4 섹션:
 *   A. 계정 정보 (display_name, team)
 *   B. PIN 변경
 *   C. 관리자 영역 (admin only)
 *   D. 위험 영역 (로그아웃·삭제)
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TEAMS,
  TEAM_LABEL,
  type Team,
} from "@/lib/auth/pin";

interface Me {
  id: string;
  email: string;
  role: "admin" | "member";
  team: Team | null;
  display_name: string | null;
  created_at: string | null;
  last_login_at: string | null;
}

interface AdminUserRow {
  id: string;
  email: string;
  role: "admin" | "member";
  team: Team | null;
  display_name: string | null;
  created_at: string | null;
  last_login_at: string | null;
  locked_until: string | null;
}

const PIN_PATTERN = /^\d{4}$/;

export function SettingsClient({ me }: { me: Me }) {
  const router = useRouter();

  // ── (A) Account state ──
  const [displayName, setDisplayName] = useState(me.display_name ?? "");
  const [team, setTeam] = useState<Team | "">(me.team ?? "");
  const [accountMsg, setAccountMsg] = useState<string | null>(null);
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [savingAccount, startAccountSave] = useTransition();

  // ── (B) PIN change ──
  const [curPin, setCurPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [savingPin, startPinSave] = useTransition();

  // ── (C) Admin section ──
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");

  // ── (D) Account delete confirmation ──
  const [delPin, setDelPin] = useState("");
  const [delConfirm, setDelConfirm] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();

  // load admin users on mount (if admin)
  useEffect(() => {
    if (me.role !== "admin") return;
    setUsersLoading(true);
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setUsers(d.users as AdminUserRow[]);
        else setUsersErr(d.message ?? "목록 로드 실패");
      })
      .catch((e) => setUsersErr(String(e)))
      .finally(() => setUsersLoading(false));
  }, [me.role]);

  // ── handlers ──
  function saveAccount() {
    setAccountMsg(null);
    setAccountErr(null);
    startAccountSave(async () => {
      const res = await fetch("/api/auth/pin/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          team: team || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAccountErr(data.message ?? "저장 실패");
        return;
      }
      setAccountMsg("저장되었습니다");
      router.refresh();
    });
  }

  function changePin() {
    setPinMsg(null);
    setPinErr(null);
    if (!PIN_PATTERN.test(curPin) || !PIN_PATTERN.test(newPin)) {
      setPinErr("PIN은 숫자 4자리여야 합니다");
      return;
    }
    if (newPin !== newPin2) {
      setPinErr("새 PIN 확인이 일치하지 않습니다");
      return;
    }
    startPinSave(async () => {
      const res = await fetch("/api/auth/pin/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_pin: curPin, new_pin: newPin }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPinErr(data.message ?? "변경 실패");
        return;
      }
      setPinMsg("PIN이 변경되었습니다");
      setCurPin("");
      setNewPin("");
      setNewPin2("");
    });
  }

  async function patchUser(
    id: string,
    payload: Record<string, unknown>,
    label: string,
  ) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      alert(`${label} 실패: ${data.message ?? "unknown"}`);
      return;
    }
    // refresh user list
    const r2 = await fetch("/api/admin/users").then((r) => r.json());
    if (r2.ok) setUsers(r2.users);
  }

  async function deleteUser(id: string, email: string) {
    if (!confirm(`정말 [${email}] 계정을 삭제할까요? (되돌릴 수 없음)`)) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      alert(`삭제 실패: ${data.message ?? "unknown"}`);
      return;
    }
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  function logout() {
    fetch("/api/auth/pin/logout", { method: "POST" }).finally(() => {
      window.location.href = "/auth/login";
    });
  }

  function deleteMyAccount() {
    setDelErr(null);
    if (!PIN_PATTERN.test(delPin)) {
      setDelErr("PIN 4자리 필요");
      return;
    }
    if (!delConfirm) {
      setDelErr("체크박스로 동의를 확인하세요");
      return;
    }
    startDeleting(async () => {
      const res = await fetch("/api/auth/pin/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: delPin }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setDelErr(data.message ?? "삭제 실패");
        return;
      }
      window.location.href = "/";
    });
  }

  const filteredUsers = users.filter((u) => {
    if (!searchQ.trim()) return true;
    const q = searchQ.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      (u.display_name?.toLowerCase().includes(q) ?? false) ||
      (u.team?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <main className="min-h-dvh w-full pb-20">
      {/* HEADER */}
      <section className="border-b-2 border-ink">
        <div className="max-w-4xl mx-auto px-6 sm:px-10 py-10">
          <p className="kicker mb-2">계정 · 보안 · 권한</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-tight tracking-tight">
            설정
          </h1>
          <div className="mt-5 flex items-baseline gap-3 flex-wrap text-sm">
            {me.role === "admin" ? (
              <span className="kicker !text-accent border border-accent px-1.5">
                ADMIN
              </span>
            ) : (
              <span className="kicker !text-cobalt">{me.team ? TEAM_LABEL[me.team] : "팀 미지정"}</span>
            )}
            <span className="font-mono text-ink">{me.email}</span>
            {me.created_at ? (
              <span className="label-mono">
                · 가입 {me.created_at.slice(0, 10)}
              </span>
            ) : null}
            {me.last_login_at ? (
              <span className="label-mono">
                · 최근 로그인 {me.last_login_at.slice(0, 10)}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* SECTION A — 계정 */}
      <section className="max-w-4xl mx-auto px-6 sm:px-10 mt-12">
        <p className="kicker mb-1">
          <span className="section-num">No. </span>01
        </p>
        <h2 className="font-display text-2xl sm:text-3xl tracking-tight leading-tight">
          계정 정보
        </h2>
        <p className="mt-1 label-mono">
          표시 이름과 소속 팀을 변경합니다. 이메일은 영구 ID로 변경 불가.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="label-mono mb-1 block">이메일 (변경 불가)</label>
            <input
              type="email"
              value={me.email}
              readOnly
              className="evidence-input opacity-60 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="label-mono mb-1 block" htmlFor="display_name">
              표시 이름
            </label>
            <input
              id="display_name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              className="evidence-input"
              placeholder="예: 김민지"
            />
          </div>

          <div>
            <label className="label-mono mb-1 block" htmlFor="team">
              소속 팀
            </label>
            <select
              id="team"
              value={team}
              onChange={(e) => setTeam(e.target.value as Team | "")}
              className="evidence-input"
            >
              <option value="">선택 안 함 (팀 무관)</option>
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {TEAM_LABEL[t]}
                </option>
              ))}
            </select>
            <p className="mt-1 label-mono">
              진단 응답이 어느 팀 시각인지 자동 태그됩니다.
            </p>
          </div>

          {accountErr ? (
            <p className="font-mono text-xs text-signal-red">⚠ {accountErr}</p>
          ) : null}
          {accountMsg ? (
            <p className="font-mono text-xs text-signal-green">✓ {accountMsg}</p>
          ) : null}

          <button
            type="button"
            onClick={saveAccount}
            disabled={savingAccount}
            className="btn-primary disabled:opacity-50"
          >
            {savingAccount ? "저장 중…" : "저장"}
            <span className="font-mono text-xs">→</span>
          </button>
        </div>
      </section>

      {/* SECTION B — PIN 변경 */}
      <section className="max-w-4xl mx-auto px-6 sm:px-10 mt-16">
        <p className="kicker mb-1">
          <span className="section-num">No. </span>02
        </p>
        <h2 className="font-display text-2xl sm:text-3xl tracking-tight leading-tight">
          PIN 변경
        </h2>
        <p className="mt-1 label-mono">
          4자리 숫자 PIN — 기억하기 쉬우면서도 추측 어려운 조합을 권장.
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label-mono mb-1 block" htmlFor="cur_pin">
              현재 PIN
            </label>
            <input
              id="cur_pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={curPin}
              onChange={(e) =>
                setCurPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="evidence-input !text-xl !font-mono !tracking-[0.4em] !text-center"
              placeholder="••••"
            />
          </div>
          <div>
            <label className="label-mono mb-1 block" htmlFor="new_pin">
              새 PIN
            </label>
            <input
              id="new_pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={newPin}
              onChange={(e) =>
                setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="evidence-input !text-xl !font-mono !tracking-[0.4em] !text-center"
              placeholder="••••"
            />
          </div>
          <div>
            <label className="label-mono mb-1 block" htmlFor="new_pin2">
              새 PIN 확인
            </label>
            <input
              id="new_pin2"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={newPin2}
              onChange={(e) =>
                setNewPin2(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="evidence-input !text-xl !font-mono !tracking-[0.4em] !text-center"
              placeholder="••••"
            />
          </div>
        </div>

        {pinErr ? (
          <p className="mt-3 font-mono text-xs text-signal-red">⚠ {pinErr}</p>
        ) : null}
        {pinMsg ? (
          <p className="mt-3 font-mono text-xs text-signal-green">
            ✓ {pinMsg}
          </p>
        ) : null}

        <button
          type="button"
          onClick={changePin}
          disabled={
            savingPin ||
            !PIN_PATTERN.test(curPin) ||
            !PIN_PATTERN.test(newPin) ||
            newPin !== newPin2
          }
          className="mt-4 btn-primary disabled:opacity-50"
        >
          {savingPin ? "변경 중…" : "PIN 변경"}
          <span className="font-mono text-xs">→</span>
        </button>
      </section>

      {/* SECTION C — 관리자 영역 (admin only) */}
      {me.role === "admin" ? (
        <section className="max-w-4xl mx-auto px-6 sm:px-10 mt-16">
          <p className="kicker mb-1 !text-accent">
            <span className="section-num">No. </span>03 · ADMIN
          </p>
          <h2 className="font-display text-2xl sm:text-3xl tracking-tight leading-tight">
            사용자 권한 관리
          </h2>
          <p className="mt-1 label-mono">
            가입한 모든 사용자의 권한·팀·잠금 상태를 관리합니다. 관리자
            승격은 신중하게 — 모든 진단 응답이 가능해집니다.
          </p>

          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <input
              type="search"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="이메일·이름·팀 검색…"
              className="evidence-input max-w-sm"
            />
            <span className="label-mono">
              {filteredUsers.length} / {users.length}명
            </span>
          </div>

          {usersErr ? (
            <p className="mt-3 font-mono text-xs text-signal-red">
              ⚠ {usersErr}
            </p>
          ) : null}

          {usersLoading ? (
            <p className="mt-6 label-mono">사용자 목록 로딩 중…</p>
          ) : (
            <div className="mt-6 overflow-x-auto border-2 border-ink">
              <table className="w-full text-sm">
                <thead className="bg-paper-soft border-b-2 border-ink">
                  <tr>
                    <th className="text-left p-3 label-mono">이메일</th>
                    <th className="text-left p-3 label-mono">이름</th>
                    <th className="text-left p-3 label-mono">팀</th>
                    <th className="text-left p-3 label-mono">권한</th>
                    <th className="text-left p-3 label-mono">최근 로그인</th>
                    <th className="text-left p-3 label-mono">동작</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const isMe = u.id === me.id;
                    const isLocked =
                      u.locked_until &&
                      new Date(u.locked_until) > new Date();
                    return (
                      <tr
                        key={u.id}
                        className={`border-t border-ink-soft/30 ${
                          isLocked ? "bg-soft-red/10" : ""
                        }`}
                      >
                        <td className="p-3 font-mono text-xs">
                          {u.email}
                          {isMe ? (
                            <span className="ml-2 label-mono">(나)</span>
                          ) : null}
                          {isLocked ? (
                            <span className="ml-2 label-mono !text-signal-red">
                              잠금
                            </span>
                          ) : null}
                        </td>
                        <td className="p-3">{u.display_name ?? "—"}</td>
                        <td className="p-3">
                          <select
                            value={u.team ?? ""}
                            onChange={(e) =>
                              patchUser(
                                u.id,
                                { team: e.target.value || null },
                                "팀 변경",
                              )
                            }
                            className="evidence-input !text-xs !py-1 !px-1.5"
                          >
                            <option value="">—</option>
                            {TEAMS.map((t) => (
                              <option key={t} value={t}>
                                {TEAM_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3">
                          <select
                            value={u.role}
                            disabled={isMe}
                            onChange={(e) =>
                              patchUser(
                                u.id,
                                { role: e.target.value },
                                "권한 변경",
                              )
                            }
                            className={`evidence-input !text-xs !py-1 !px-1.5 ${
                              u.role === "admin"
                                ? "!text-accent !border-accent font-medium"
                                : ""
                            }`}
                            title={
                              isMe
                                ? "본인 권한은 여기서 변경 불가"
                                : "권한 변경"
                            }
                          >
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td className="p-3 label-mono">
                          {u.last_login_at
                            ? u.last_login_at.slice(0, 10)
                            : "—"}
                        </td>
                        <td className="p-3 flex gap-2 flex-wrap">
                          {isLocked ? (
                            <button
                              type="button"
                              onClick={() =>
                                patchUser(u.id, { unlock: true }, "잠금 해제")
                              }
                              className="label-mono hover:text-ink"
                            >
                              잠금 해제
                            </button>
                          ) : null}
                          {!isMe ? (
                            <button
                              type="button"
                              onClick={() => deleteUser(u.id, u.email)}
                              className="label-mono !text-signal-red hover:underline"
                            >
                              삭제
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-6 text-center label-mono"
                      >
                        결과 없음
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 label-mono text-ink-soft">
            · 본인 권한은 본인이 변경 불가 (마지막 관리자 보호 + 자살 방지)
            <br />· 마지막 관리자가 1명일 때 강등·삭제 거부됨
            <br />· 사용자 삭제 시 그가 작성한 진단 응답의 profile 링크만
            끊김 — 응답 데이터 자체는 보존
          </p>
        </section>
      ) : null}

      {/* SECTION D — 위험 영역 */}
      <section className="max-w-4xl mx-auto px-6 sm:px-10 mt-16">
        <p className="kicker mb-1 !text-signal-red">
          <span className="section-num">No. </span>
          {me.role === "admin" ? "04" : "03"} · 위험 영역
        </p>
        <h2 className="font-display text-2xl sm:text-3xl tracking-tight leading-tight">
          로그아웃 · 계정 삭제
        </h2>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Logout */}
          <div className="border-l-4 border-ink-soft/50 pl-4">
            <p className="kicker mb-1">로그아웃</p>
            <p className="text-sm leading-relaxed text-ink-soft">
              이 기기에서 세션 쿠키만 제거. 계정·데이터는 그대로 보존.
            </p>
            <button
              type="button"
              onClick={logout}
              className="mt-3 btn-secondary"
            >
              로그아웃
              <span className="font-mono text-xs">→</span>
            </button>
          </div>

          {/* Account delete */}
          <div className="border-l-4 border-signal-red pl-4">
            <p className="kicker mb-1 !text-signal-red">내 계정 삭제</p>
            <p className="text-sm leading-relaxed text-ink-soft">
              영구 삭제 — 되돌릴 수 없습니다. 작성한 진단 응답은 익명으로
              보존됩니다.
            </p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={delPin}
              onChange={(e) =>
                setDelPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="mt-3 evidence-input !text-lg !font-mono !tracking-[0.4em] !text-center max-w-[10rem]"
              placeholder="본인 PIN"
            />
            <label className="mt-3 flex items-baseline gap-2 text-sm">
              <input
                type="checkbox"
                checked={delConfirm}
                onChange={(e) => setDelConfirm(e.target.checked)}
              />
              <span>되돌릴 수 없음을 이해함</span>
            </label>
            {delErr ? (
              <p className="mt-2 font-mono text-xs text-signal-red">
                ⚠ {delErr}
              </p>
            ) : null}
            <button
              type="button"
              onClick={deleteMyAccount}
              disabled={deleting || !delConfirm || !PIN_PATTERN.test(delPin)}
              className="mt-3 px-3 py-2 text-sm font-medium border-2 border-signal-red text-signal-red hover:bg-signal-red hover:text-paper transition-colors disabled:opacity-50"
            >
              {deleting ? "삭제 중…" : "내 계정 삭제"}
              <span className="font-mono text-xs ml-1">→</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

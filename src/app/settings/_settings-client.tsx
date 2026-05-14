"use client";

/**
 * /settings client shell — 4 섹션:
 *   A. 계정 정보 (display_name, team)
 *   B. PIN 변경
 *   C. 관리자 영역 (admin only)
 *   D. 위험 영역 (로그아웃·삭제)
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TEAMS,
  TEAM_LABEL,
  type Team,
} from "@/lib/auth/pin";
import { PinField } from "@/components/ui/pin-field";

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
          <PinField
            id="cur_pin"
            label="현재 PIN"
            value={curPin}
            onChange={setCurPin}
            autoComplete="current-password"
          />
          <PinField
            id="new_pin"
            label="새 PIN"
            value={newPin}
            onChange={setNewPin}
            autoComplete="new-password"
          />
          <PinField
            id="new_pin2"
            label="새 PIN 확인"
            value={newPin2}
            onChange={setNewPin2}
            autoComplete="new-password"
          />
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
        <AdminSection
          me={me}
          users={users}
          usersLoading={usersLoading}
          usersErr={usersErr}
          searchQ={searchQ}
          setSearchQ={setSearchQ}
          filteredUsers={filteredUsers}
          patchUser={patchUser}
          deleteUser={deleteUser}
        />
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
            <div className="mt-3 max-w-[12rem]">
              <PinField
                id="del_pin"
                label="본인 PIN"
                value={delPin}
                onChange={setDelPin}
                autoComplete="current-password"
              />
            </div>
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

// ============================================================================
// AdminSection — 관리자 권한 부여 (집중 카드) + 사용자 카드 리스트
// ============================================================================

interface AdminSectionProps {
  me: Me;
  users: AdminUserRow[];
  usersLoading: boolean;
  usersErr: string | null;
  searchQ: string;
  setSearchQ: (q: string) => void;
  filteredUsers: AdminUserRow[];
  patchUser: (
    id: string,
    payload: Record<string, unknown>,
    label: string,
  ) => Promise<void>;
  deleteUser: (id: string, email: string) => Promise<void>;
}

function AdminSection({
  me,
  users,
  usersLoading,
  usersErr,
  searchQ,
  setSearchQ,
  filteredUsers,
  patchUser,
  deleteUser,
}: AdminSectionProps) {
  // ── 권한 부여 집중 카드 state ──
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantMsg, setGrantMsg] = useState<string | null>(null);
  const [grantErr, setGrantErr] = useState<string | null>(null);

  // 후보 = 본인 제외한 모든 사용자 (관리자 승격은 본인이 본인을 할 일 없음)
  const candidates = useMemo(
    () => users.filter((u) => u.id !== me.id),
    [users, me.id],
  );
  const selectedUser = candidates.find((u) => u.id === selectedUserId);

  // member 후보만 보여주는 옵션 vs admin 해제 후보 — 둘 다 표시 (현재 role 에 따라 동작 결정)
  const targetRole: "admin" | "member" =
    selectedUser?.role === "admin" ? "member" : "admin";

  async function applyRoleChange() {
    if (!selectedUser) return;
    setGrantBusy(true);
    setGrantErr(null);
    setGrantMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: targetRole }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setGrantErr(data.message ?? "변경 실패");
        return;
      }
      setGrantMsg(
        targetRole === "admin"
          ? `${selectedUser.email} 을(를) 관리자로 승격했습니다`
          : `${selectedUser.email} 의 관리자 권한을 해제했습니다`,
      );
      // 부모 list 갱신 — patchUser 호출로 reuse
      await patchUser(selectedUser.id, {}, "새로고침");
      setSelectedUserId("");
    } finally {
      setGrantBusy(false);
    }
  }

  return (
    <section className="max-w-4xl mx-auto px-6 sm:px-10 mt-16">
      <p className="kicker mb-1 !text-accent">
        <span className="section-num">No. </span>03 · ADMIN
      </p>
      <h2 className="font-display text-2xl sm:text-3xl tracking-tight leading-tight">
        관리자 권한 관리
      </h2>
      <p className="mt-1 label-mono">
        관리자 승격은 신중하게 — 승격된 사용자는 모든 진단 응답·다른 팀
        데이터 수정·계정 관리에 접근할 수 있습니다.
      </p>

      {/* ─── 권한 부여 집중 카드 ─── */}
      <div className="mt-6 border-2 border-accent bg-soft-amber/20 p-5 sm:p-6">
        <p className="kicker !text-accent mb-2">관리자 권한 부여 / 해제</p>
        <h3 className="font-display text-xl leading-tight mb-4">
          한 사용자를 선택해 권한을 바꾸세요
        </h3>

        {usersLoading ? (
          <p className="label-mono">사용자 목록 로딩 중…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-ink-soft">
            본인 외 다른 사용자가 없습니다 — 가입을 권유하세요.
          </p>
        ) : (
          <>
            <label className="label-mono mb-1 block" htmlFor="grant_user">
              사용자 선택
            </label>
            <select
              id="grant_user"
              value={selectedUserId}
              onChange={(e) => {
                setSelectedUserId(e.target.value);
                setGrantMsg(null);
                setGrantErr(null);
              }}
              className="evidence-input"
            >
              <option value="">— 사용자를 고르세요 —</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                  {u.display_name ? ` · ${u.display_name}` : ""}
                  {" · "}
                  현재 {u.role === "admin" ? "관리자" : "팀 멤버"}
                  {u.team ? ` · ${TEAM_LABEL[u.team]}` : ""}
                </option>
              ))}
            </select>

            {/* 선택 후 preview + 확인 버튼 */}
            {selectedUser ? (
              <div className="mt-5 pt-5 border-t border-ink-soft/40">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
                  <div>
                    <span className="label-mono">이메일</span>
                    <p className="font-mono text-ink">{selectedUser.email}</p>
                  </div>
                  <div>
                    <span className="label-mono">이름</span>
                    <p>{selectedUser.display_name ?? "—"}</p>
                  </div>
                  <div>
                    <span className="label-mono">소속 팀</span>
                    <p>
                      {selectedUser.team ? TEAM_LABEL[selectedUser.team] : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="label-mono">현재 권한</span>
                    <p
                      className={
                        selectedUser.role === "admin"
                          ? "text-accent font-semibold"
                          : ""
                      }
                    >
                      {selectedUser.role === "admin" ? "관리자" : "팀 멤버"}
                    </p>
                  </div>
                </div>

                <p
                  className={`text-sm leading-relaxed mb-3 ${
                    targetRole === "admin"
                      ? "text-accent"
                      : "text-signal-red"
                  }`}
                >
                  {targetRole === "admin" ? (
                    <>
                      ⚡ 이 작업으로 <strong>{selectedUser.email}</strong> 가
                      <strong> 관리자</strong>로 승격됩니다. 모든 진단·코칭·
                      사용자 권한·데이터 삭제 작업이 가능해집니다.
                    </>
                  ) : (
                    <>
                      ↓ 이 작업으로 <strong>{selectedUser.email}</strong> 의
                      관리자 권한이 <strong>해제</strong>됩니다. 본인 팀
                      시각으로만 응답 가능해집니다.
                    </>
                  )}
                </p>

                <button
                  type="button"
                  onClick={applyRoleChange}
                  disabled={grantBusy}
                  className={`disabled:opacity-50 px-4 py-2 text-sm font-medium border-2 transition-colors ${
                    targetRole === "admin"
                      ? "border-accent text-accent hover:bg-accent hover:text-paper"
                      : "border-signal-red text-signal-red hover:bg-signal-red hover:text-paper"
                  }`}
                >
                  {grantBusy
                    ? "변경 중…"
                    : targetRole === "admin"
                      ? "관리자로 승격"
                      : "관리자 권한 해제"}
                  <span className="font-mono text-xs ml-1">→</span>
                </button>
              </div>
            ) : (
              <p className="mt-3 label-mono text-ink-soft">
                사용자를 선택하면 상세 정보와 변경 미리보기가 표시됩니다.
              </p>
            )}

            {grantErr ? (
              <p className="mt-3 font-mono text-xs text-signal-red">
                ⚠ {grantErr}
              </p>
            ) : null}
            {grantMsg ? (
              <p className="mt-3 font-mono text-xs text-signal-green">
                ✓ {grantMsg}
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* ─── 전체 사용자 카드 리스트 ─── */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <h3 className="font-display text-xl leading-tight">
            전체 사용자 목록
          </h3>
          <div className="flex items-center gap-3">
            <input
              type="search"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="이메일·이름·팀 검색…"
              className="evidence-input !py-1 !px-2 !text-sm max-w-[14rem]"
            />
            <span className="label-mono">
              {filteredUsers.length} / {users.length}명
            </span>
          </div>
        </div>

        {usersErr ? (
          <p className="font-mono text-xs text-signal-red mb-3">⚠ {usersErr}</p>
        ) : null}

        {filteredUsers.length === 0 ? (
          <p className="label-mono text-ink-soft p-6 border border-ink-soft/40 text-center">
            결과 없음
          </p>
        ) : (
          <ul className="space-y-3">
            {filteredUsers.map((u) => {
              const isMe = u.id === me.id;
              const isLocked =
                u.locked_until && new Date(u.locked_until) > new Date();
              const isAdmin = u.role === "admin";
              return (
                <li
                  key={u.id}
                  className={`border-2 p-4 sm:p-5 ${
                    isAdmin
                      ? "border-accent bg-soft-amber/10"
                      : "border-ink-soft/40 bg-paper"
                  } ${isLocked ? "ring-2 ring-signal-red/50" : ""}`}
                >
                  {/* Header — identity + badges */}
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                    <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                      {isAdmin ? (
                        <span className="kicker !text-accent border border-accent px-1.5">
                          ADMIN
                        </span>
                      ) : (
                        <span className="kicker !text-cobalt">MEMBER</span>
                      )}
                      <span className="font-mono text-sm text-ink break-all">
                        {u.email}
                      </span>
                      {isMe ? (
                        <span className="label-mono">(나)</span>
                      ) : null}
                      {isLocked ? (
                        <span className="label-mono !text-signal-red">
                          잠금 중
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Meta row */}
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm mb-4">
                    <div>
                      <dt className="label-mono">이름</dt>
                      <dd>{u.display_name ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="label-mono">소속 팀</dt>
                      <dd>{u.team ? TEAM_LABEL[u.team] : "—"}</dd>
                    </div>
                    <div>
                      <dt className="label-mono">가입</dt>
                      <dd className="label-mono">
                        {u.created_at ? u.created_at.slice(0, 10) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-mono">최근 로그인</dt>
                      <dd className="label-mono">
                        {u.last_login_at
                          ? u.last_login_at.slice(0, 10)
                          : "—"}
                      </dd>
                    </div>
                  </dl>

                  {/* Action row */}
                  <div className="flex items-center gap-3 flex-wrap pt-3 border-t border-ink-soft/30">
                    <label className="label-mono">팀 변경:</label>
                    <select
                      value={u.team ?? ""}
                      onChange={(e) =>
                        patchUser(
                          u.id,
                          { team: e.target.value || null },
                          "팀 변경",
                        )
                      }
                      className="evidence-input !text-xs !py-1 !px-2 max-w-[10rem]"
                    >
                      <option value="">— 미지정</option>
                      {TEAMS.map((t) => (
                        <option key={t} value={t}>
                          {TEAM_LABEL[t]}
                        </option>
                      ))}
                    </select>

                    {isLocked ? (
                      <button
                        type="button"
                        onClick={() =>
                          patchUser(u.id, { unlock: true }, "잠금 해제")
                        }
                        className="label-mono hover:text-ink border border-ink-soft/40 px-2 py-1 hover:border-ink"
                      >
                        잠금 해제
                      </button>
                    ) : null}

                    {!isMe ? (
                      <button
                        type="button"
                        onClick={() => deleteUser(u.id, u.email)}
                        className="ml-auto label-mono !text-signal-red hover:underline"
                      >
                        삭제
                      </button>
                    ) : (
                      <span className="ml-auto label-mono text-ink-soft">
                        본인 계정 — 위험 영역에서 삭제
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-4 label-mono text-ink-soft leading-relaxed">
          · 권한 변경은 위 "관리자 권한 부여 / 해제" 카드에서 한 명씩 신중하게.
          <br />
          · 팀 변경·잠금 해제·삭제는 각 카드에서 즉시 가능.
          <br />
          · 마지막 관리자가 1명일 때 강등·삭제 거부됨 (서버 측 안전장치).
        </p>
      </div>
    </section>
  );
}

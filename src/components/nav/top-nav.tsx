"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";

interface Props {
  userEmail: string | null;
}

interface NavItem {
  href: string;
  label: string;
  short?: string;
}

const GLOBAL_NAV: NavItem[] = [
  { href: "/", label: "홈", short: "홈" },
  { href: "/diag", label: "진단", short: "진단" },
  { href: "/me", label: "내 워크스페이스", short: "내 워크스페이스" },
];

/** 일상 흐름 — 4개로 압축. 진단→홈→실행→타임라인의 자연 순서. */
function workspacePrimaryNav(ws: string): NavItem[] {
  return [
    { href: `/diag/${ws}/home`, label: "홈", short: "홈" },
    { href: `/diag/${ws}/worklist`, label: "워크리스트", short: "워크리스트" },
    { href: `/diag/${ws}/actions`, label: "액션", short: "액션" },
    { href: `/diag/${ws}/timeline`, label: "타임라인", short: "타임라인" },
  ];
}

/** 가끔 보는 운영·관리 — 드롭다운. 깊이 보기 + 설정. */
function workspaceSecondaryNav(ws: string): NavItem[] {
  return [
    { href: `/diag/${ws}/result`, label: "결과 상세 — 요인 분해·breakdown" },
    { href: `/diag/${ws}/signals`, label: "시그널 피드 — KPI 자동 측정" },
    { href: `/diag/${ws}/members`, label: "멤버 관리" },
    { href: `/diag/${ws}/integrations`, label: "외부 연동" },
    { href: `/diag/${ws}/audit`, label: "감사 — 응답·코칭 로그" },
  ];
}

/**
 * 어떤 워크스페이스든 bulk AI 자동 생성이 진행 중인지 확인.
 * localStorage 키 `worklist:bulk:running:*` 가 존재하고 같은 ws의 dismiss
 * 플래그가 없으면 active.
 */
function detectBulkActive(): boolean {
  if (typeof window === "undefined") return false;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith("worklist:bulk:running:")) continue;
    const ws = key.slice("worklist:bulk:running:".length);
    const dismissKey = `worklist:bulk:dismissed:${ws}`;
    if (!window.localStorage.getItem(dismissKey)) return true;
  }
  return false;
}

export function TopNav({ userEmail }: Props) {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);

  // Hide nav on the auth/login page only
  const hideNav = pathname.startsWith("/auth/login");

  // Detect workspace context (/diag/[ws]/...)
  const wsMatch = pathname.match(/^\/diag\/([a-zA-Z0-9_-]{3,50})(\/|$)/);
  const ws = wsMatch ? wsMatch[1] : null;
  const primaryItems: NavItem[] = ws ? workspacePrimaryNav(ws) : [];
  const secondaryItems: NavItem[] = ws ? workspaceSecondaryNav(ws) : [];

  // Manage state
  const [adminOpen, setAdminOpen] = useState(false);

  // Bulk AI 자동 생성 진행 상태 — 워크리스트 GNB 링크에 로딩 바 표시
  const [bulkActive, setBulkActive] = useState(false);

  useEffect(() => {
    setBulkActive(detectBulkActive());
    const onState = (e: Event) => {
      const ce = e as CustomEvent<{ active?: boolean }>;
      if (typeof ce.detail?.active === "boolean") {
        setBulkActive(ce.detail.active || detectBulkActive());
      } else {
        setBulkActive(detectBulkActive());
      }
    };
    const onStorage = () => setBulkActive(detectBulkActive());
    window.addEventListener("worklist:bulk:state", onState);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("worklist:bulk:state", onState);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Close menus on route change
  useEffect(() => {
    setOpen(false);
    setAdminOpen(false);
  }, [pathname]);

  // Close admin dropdown on outside click
  useEffect(() => {
    if (!adminOpen) return;
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-admin-dropdown]")) setAdminOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [adminOpen]);

  if (hideNav) return null;

  return (
    <header className="border-b-2 border-ink bg-paper sticky top-0 z-30 print:hidden">
      {/* ============== ROW 1 — Global ============== */}
      <div className="max-w-7xl mx-auto px-6 sm:px-10 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="font-display text-lg font-semibold tracking-tight">
              Kinder Stick
            </span>
            <span className="kicker !text-ink-soft hidden sm:inline">OS</span>
          </Link>
        </div>

        {/* Global nav (always the same) */}
        <nav
          className="hidden md:flex items-center gap-2 flex-1 justify-center"
          aria-label="Global"
        >
          {GLOBAL_NAV.map((item) => {
            const active = isActive(pathname, item.href, ws);
            const isWorklist = item.href === "/worklist";
            const showLoader = isWorklist && bulkActive;
            return (
              <span
                key={item.href}
                className="relative inline-flex flex-col items-stretch"
              >
                <Link
                  href={item.href}
                  className={`px-3 py-1.5 text-sm font-medium tracking-tight transition-colors border-b-2 -mb-[2px] ${
                    active
                      ? "border-accent text-ink"
                      : "border-transparent text-ink-soft hover:text-ink hover:border-ink-soft"
                  }`}
                  title={showLoader ? "AI 자동 생성 진행 중" : undefined}
                >
                  {item.short ?? item.label}
                </Link>
                {showLoader ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 right-0 bottom-[-2px] h-0.5 bg-accent origin-left"
                    style={{
                      animation: "nav-loader-fill 1.4s ease-in-out infinite",
                    }}
                  />
                ) : null}
              </span>
            );
          })}
        </nav>

        {/* User area */}
        <div className="flex items-center gap-2 shrink-0">
          {userEmail ? (
            <div className="hidden md:flex items-center gap-2">
              <Link
                href="/me"
                className="label-mono hover:text-ink truncate max-w-[140px]"
              >
                {userEmail.split("@")[0]}
              </Link>
              <span className="label-mono opacity-40">·</span>
              <Link href="/auth/logout" className="label-mono hover:text-ink">
                logout
              </Link>
            </div>
          ) : (
            <Link
              href="/auth/login"
              className="hidden md:inline-flex items-center px-3 py-1.5 text-sm font-semibold border-2 border-ink hover:bg-ink hover:text-paper transition-colors"
            >
              Sign in
            </Link>
          )}

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="md:hidden p-1.5 border border-ink-soft hover:border-ink"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              {open ? (
                <path d="M6 6L18 18M6 18L18 6" />
              ) : (
                <path d="M4 7H20M4 12H20M4 17H20" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* ============== ROW 2 — Workspace tools (only in workspace) ============== */}
      {ws ? (
        <div className="border-t border-ink-soft/30 bg-paper-soft hidden md:block">
          <div className="max-w-7xl mx-auto px-6 sm:px-10 h-11 flex items-center gap-4">
            {/* WS chip */}
            <Link
              href={`/diag/${ws}/home`}
              className="flex items-baseline gap-1.5 px-2 py-1 border border-ink-soft hover:border-ink hover:bg-paper-deep transition-colors min-w-0 shrink-0"
              title={`Workspace: ${ws}`}
            >
              <span className="label-mono">WS</span>
              <span className="font-mono text-xs truncate max-w-[180px]">
                {ws}
              </span>
            </Link>

            {/* Workspace primary nav (5 items) */}
            <nav
              className="flex items-center gap-0.5 flex-1 overflow-x-auto"
              aria-label="Workspace"
            >
              {primaryItems.map((item) => {
                const active = isActive(pathname, item.href, ws);
                const isWorklist = item.href.endsWith("/worklist");
                const showLoader = isWorklist && bulkActive;
                return (
                  <span
                    key={item.href}
                    className="relative inline-flex flex-col items-stretch"
                  >
                    <Link
                      href={item.href}
                      className={`px-2.5 py-1 text-sm font-medium tracking-tight transition-colors border-b-2 -mb-[1px] whitespace-nowrap ${
                        active
                          ? "border-accent text-ink"
                          : "border-transparent text-ink-soft hover:text-ink hover:border-ink-soft"
                      }`}
                      title={showLoader ? "AI 자동 생성 진행 중" : undefined}
                    >
                      {item.short ?? item.label}
                    </Link>
                    {showLoader ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-0 right-0 bottom-[-1px] h-0.5 bg-accent origin-left"
                        style={{
                          animation:
                            "nav-loader-fill 1.4s ease-in-out infinite",
                        }}
                      />
                    ) : null}
                  </span>
                );
              })}
            </nav>

            {/* Admin/관리 dropdown — secondary tools */}
            <div data-admin-dropdown className="relative shrink-0">
              <button
                type="button"
                onClick={() => setAdminOpen((v) => !v)}
                className={`px-2.5 py-1 text-sm font-medium tracking-tight transition-colors border-b-2 -mb-[1px] whitespace-nowrap flex items-center gap-1 ${
                  adminOpen ||
                  secondaryItems.some((i) => isActive(pathname, i.href, ws))
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-soft hover:text-ink hover:border-ink-soft"
                }`}
                aria-expanded={adminOpen}
                aria-haspopup="menu"
              >
                관리
                <span className="font-mono text-[9px]">▾</span>
              </button>
              {adminOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-8 z-30 w-64 bg-paper border-2 border-ink shadow-lg py-1"
                >
                  {secondaryItems.map((item) => {
                    const active = isActive(pathname, item.href, ws);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        className={`block px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-paper-deep text-ink font-medium"
                            : "text-ink-soft hover:bg-paper-deep hover:text-ink"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Switch */}
            <Link
              href="/diag"
              className="label-mono hover:text-ink shrink-0"
              title="다른 워크스페이스로 전환"
            >
              ⇆ switch
            </Link>
          </div>
        </div>
      ) : null}

      {/* ============== Mobile dropdown ============== */}
      {open ? (
        <div className="md:hidden border-t border-ink-soft bg-paper-soft">
          <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col gap-1">
            {/* Global */}
            <p className="label-mono mb-1">GLOBAL</p>
            {GLOBAL_NAV.map((item) => {
              const active = isActive(pathname, item.href, ws);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-2 py-2 text-sm font-medium border-l-2 ${
                    active
                      ? "border-accent text-ink bg-paper-deep"
                      : "border-transparent text-ink-soft hover:text-ink hover:border-ink-soft"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}

            {ws ? (
              <>
                <div className="mt-3 mb-1 flex items-baseline gap-2">
                  <span className="label-mono">WORKSPACE</span>
                  <span className="font-mono text-xs">{ws}</span>
                  <Link
                    href="/diag"
                    className="ml-auto label-mono hover:text-ink"
                  >
                    ⇆ switch
                  </Link>
                </div>
                {primaryItems.map((item) => {
                  const active = isActive(pathname, item.href, ws);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`px-2 py-2 text-sm font-medium border-l-2 ${
                        active
                          ? "border-accent text-ink bg-paper-deep"
                          : "border-transparent text-ink-soft hover:text-ink hover:border-ink-soft"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                <p className="label-mono mt-3 mb-1">관리</p>
                {secondaryItems.map((item) => {
                  const active = isActive(pathname, item.href, ws);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`px-2 py-2 text-xs border-l-2 ${
                        active
                          ? "border-accent text-ink bg-paper-deep"
                          : "border-transparent text-ink-soft hover:text-ink"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </>
            ) : null}

            <div className="mt-3 pt-2 border-t border-ink-soft/40 flex items-center gap-3">
              {userEmail ? (
                <>
                  <Link href="/me" className="label-mono hover:text-ink">
                    {userEmail.split("@")[0]}
                  </Link>
                  <Link
                    href="/auth/logout"
                    className="label-mono hover:text-ink ml-auto"
                  >
                    logout
                  </Link>
                </>
              ) : (
                <Link
                  href="/auth/login"
                  className="label-mono hover:text-ink"
                >
                  Sign in →
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function isActive(
  pathname: string,
  href: string,
  ws: string | null,
): boolean {
  if (href === "/") return pathname === "/";
  // 진단 시작: highlighted on /diag landing only (workspaces have their own row)
  if (href === "/diag") return pathname === "/diag";
  // 내 워크스페이스: highlighted on /me OR inside any workspace
  // (워크리스트 글로벌 라우트는 제거됨 — 워크스페이스 컨텍스트의 primary nav에서만 접근)
  if (href === "/me") {
    if (pathname === "/me") return true;
    // 워크스페이스 내부 어느 페이지든 "내 워크스페이스" 메뉴를 active로 표시
    if (ws !== null && pathname.startsWith("/diag/")) {
      return true;
    }
    return false;
  }
  // For /diag/[ws] (the diagnosis form root), active only when exactly on it
  if (/^\/diag\/[a-zA-Z0-9_-]+$/.test(href)) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

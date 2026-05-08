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
  { href: "/worklist", label: "워크리스트", short: "워크리스트" },
  { href: "/me", label: "내 워크스페이스", short: "내 워크스페이스" },
];

/** 직원 일상 흐름 — 자주 보는 5개만 primary로 노출 */
function workspacePrimaryNav(ws: string): NavItem[] {
  return [
    { href: `/diag/${ws}/dashboard`, label: "대시보드", short: "대시보드" },
    { href: `/diag/${ws}/worklist`, label: "워크리스트", short: "워크리스트" },
    { href: `/diag/${ws}/actions`, label: "액션", short: "액션" },
    { href: `/diag/${ws}/result`, label: "결과", short: "결과" },
    { href: `/diag/${ws}`, label: "재진단", short: "재진단" },
  ];
}

/** 가끔 보는 운영·관리 — 드롭다운에 정리 */
function workspaceSecondaryNav(ws: string): NavItem[] {
  return [
    { href: `/diag/${ws}/timeline`, label: "타임라인 — 분기별 변화" },
    { href: `/diag/${ws}/signals`, label: "KPI 시그널 — 자동 측정" },
    { href: `/diag/${ws}/members`, label: "멤버 관리" },
    { href: `/diag/${ws}/integrations`, label: "외부 연동" },
    { href: `/diag/${ws}/audit`, label: "감사 — 코칭 효과 분석" },
  ];
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
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 text-sm font-medium tracking-tight transition-colors border-b-2 -mb-[2px] ${
                  active
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-soft hover:text-ink hover:border-ink-soft"
                }`}
              >
                {item.short ?? item.label}
              </Link>
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
              href={`/diag/${ws}/dashboard`}
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
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-2.5 py-1 text-sm font-medium tracking-tight transition-colors border-b-2 -mb-[1px] whitespace-nowrap ${
                      active
                        ? "border-accent text-ink"
                        : "border-transparent text-ink-soft hover:text-ink hover:border-ink-soft"
                    }`}
                  >
                    {item.short ?? item.label}
                  </Link>
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
  // 워크리스트 (global): highlighted on /worklist OR /diag/[ws]/worklist
  if (href === "/worklist") {
    return (
      pathname === "/worklist" ||
      (ws !== null && pathname.startsWith(`/diag/${ws}/worklist`))
    );
  }
  // 내 워크스페이스: highlighted on /me OR inside any workspace
  // (but NOT when we're specifically on /diag/[ws]/worklist — that goes to 워크리스트)
  if (href === "/me") {
    if (pathname === "/me") return true;
    if (ws !== null && pathname.startsWith("/diag/")) {
      return !pathname.startsWith(`/diag/${ws}/worklist`);
    }
    return false;
  }
  // For /diag/[ws] (the diagnosis form root), active only when exactly on it
  if (/^\/diag\/[a-zA-Z0-9_-]+$/.test(href)) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

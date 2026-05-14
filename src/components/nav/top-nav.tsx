"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";

interface Props {
  userEmail: string | null;
  userRole?: "admin" | "member" | null;
}

interface NavItem {
  href: string;
  label: string;
  short?: string;
}

const GLOBAL_NAV: NavItem[] = [
  { href: "/", label: "홈", short: "홈" },
  { href: "/diag", label: "진단", short: "진단" },
  { href: "/worklist", label: "내 워크리스트", short: "내 워크리스트" },
];

// 워크스페이스별 진입점들 (홈·액션·타임라인·결과·시그널·멤버·연동·감사) 는
// /diag 페이지의 워크스페이스 카드에 통합됨. 별도 secondary nav 불필요.

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

export function TopNav({ userEmail, userRole }: Props) {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);

  // Hide nav on the auth/login page only
  const hideNav = pathname.startsWith("/auth/login");

  // Detect workspace context (/diag/[ws]/...)
  const wsMatch = pathname.match(/^\/diag\/([a-zA-Z0-9_-]{3,50})(\/|$)/);
  const ws = wsMatch ? wsMatch[1] : null;

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
  }, [pathname]);

  // 마지막 진입 워크스페이스를 localStorage 에 저장 → "내 워크리스트" 진입 시 사용
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (ws) {
      try {
        window.localStorage.setItem("kso:last-workspace", ws);
      } catch {
        // ignore
      }
    }
  }, [ws]);

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
              {userRole === "admin" ? (
                <span
                  className="label-mono !text-accent border border-accent px-1.5"
                  title="관리자"
                >
                  ADMIN
                </span>
              ) : null}
              <span className="label-mono truncate max-w-[120px]">
                {userEmail.split("@")[0]}
              </span>
              <span className="label-mono opacity-40">·</span>
              <Link
                href="/settings"
                className="label-mono hover:text-ink"
                title="계정 · 팀 · PIN · 관리자"
              >
                설정
              </Link>
            </div>
          ) : (
            <Link
              href="/auth/login"
              className="hidden md:inline-flex items-center px-3 py-1.5 text-sm font-medium label-mono hover:text-ink"
            >
              로그인 →
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

      {/* Row 2 (Workspace secondary nav) 통째 제거.
          워크스페이스 진입점들은 /diag 페이지의 워크스페이스 카드에 통합됨. */}

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
              <div className="mt-3 mb-1 flex items-baseline gap-2">
                <span className="label-mono">현재 카드</span>
                <span className="font-mono text-xs">{ws}</span>
                <Link
                  href="/diag"
                  className="ml-auto label-mono hover:text-ink"
                >
                  ⇆ 다른 카드
                </Link>
              </div>
            ) : null}

            <div className="mt-3 pt-2 border-t border-ink-soft/40 flex items-center gap-3">
              {userEmail ? (
                <>
                  {userRole === "admin" ? (
                    <span className="label-mono !text-accent border border-accent px-1.5">
                      ADMIN
                    </span>
                  ) : null}
                  <span className="label-mono">
                    {userEmail.split("@")[0]}
                  </span>
                  <Link
                    href="/settings"
                    className="label-mono hover:text-ink ml-auto"
                  >
                    설정 →
                  </Link>
                </>
              ) : (
                <Link
                  href="/auth/login"
                  className="label-mono hover:text-ink"
                >
                  로그인 →
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
  // 내 워크리스트: 글로벌 /worklist OR 어느 워크스페이스든 /diag/{ws}/worklist 에 있을 때
  if (href === "/worklist") {
    if (pathname === "/worklist") return true;
    if (ws !== null && pathname === `/diag/${ws}/worklist`) return true;
    return false;
  }
  // For /diag/[ws] (the diagnosis form root), active only when exactly on it
  if (/^\/diag\/[a-zA-Z0-9_-]+$/.test(href)) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

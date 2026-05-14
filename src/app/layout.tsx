import type { Metadata } from "next";
import { TopNav } from "@/components/nav/top-nav";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getCurrentProfile } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kinder Stick OS — 진단·코칭 운영 시스템",
  description:
    "EdTech 조직의 14-도메인 진단, Bayesian 실패확률 산출, AI 도메인 코치를 한 화면에서.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // PIN auth 우선 — PIN 세션이 있으면 Supabase 조회 생략 (모든 페이지 렌더의
  // 2번 DB 왕복 절약). PIN 없을 때만 legacy Supabase 매직링크 fallback.
  const pinProfile = await getCurrentProfile().catch(() => null);
  let userEmail: string | null = pinProfile?.email ?? null;
  const userRole = pinProfile?.role ?? null;
  if (!pinProfile) {
    const supabaseUser = await getCurrentUser().catch(() => null);
    userEmail = supabaseUser?.email ?? null;
  }

  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,900;1,9..144,400&family=Pretendard:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="grain">
        <div
          className="paper-bg min-h-dvh relative flex flex-col"
          style={{ zIndex: 2 }}
        >
          <TopNav userEmail={userEmail} userRole={userRole} />
          <div className="flex-1 flex flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}

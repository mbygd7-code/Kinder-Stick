import type { Metadata } from "next";
import { TopNav } from "@/components/nav/top-nav";
import { getCurrentUser } from "@/lib/supabase/auth";
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
  const currentUser = await getCurrentUser();

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
          <TopNav
            userEmail={currentUser?.email ?? null}
          />
          <div className="flex-1 flex flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}

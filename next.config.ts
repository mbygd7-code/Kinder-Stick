import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.219.188"],
  experimental: {
    // 클라이언트 라우터 캐시. dynamic 페이지(우리는 거의 모든 페이지가 dynamic)도
    // 한 번 가져온 RSC payload 를 staleTimes.dynamic 동안 재사용해서 페이지 간
    // back/forward·재방문 시 즉시 표시. (기본값은 0 — 매번 재요청)
    staleTimes: {
      dynamic: 60, // 1분간 stale-while-revalidate
      static: 300, // 5분
    },
  },
};

export default nextConfig;

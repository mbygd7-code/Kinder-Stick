import { notFound } from "next/navigation";
import { loadFramework } from "@/lib/framework/loader";
import { UnifiedDiagnosisShell } from "./_unified-shell";
import { DiagnosisPermissionBanner } from "./_permission-banner";

interface Props {
  params: Promise<{ workspace: string }>;
}

const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;

/**
 * 통합 진단 페이지 — Appendix G.
 * 한 페이지에서 (A) 운영 정보 + (B) 진단 응답 + (C) 결과 + (D) 이전 이력.
 */
export default async function DiagnosisPage({ params }: Props) {
  const { workspace } = await params;
  if (!WS_PATTERN.test(workspace)) {
    notFound();
  }

  const framework = loadFramework();

  return (
    <>
      {/* PIN 로그인 권한 배너 (admin / 팀멤버 / 익명) */}
      <DiagnosisPermissionBanner />
      <UnifiedDiagnosisShell workspace={workspace} framework={framework} />
    </>
  );
}

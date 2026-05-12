/**
 * /diag/[workspace]/dashboard — 옛 URL 호환 redirect
 *
 * 통합 정보 아키텍처 변경 후 /home 으로 모든 hub 콘텐츠가 이전됨.
 * 기존 북마크·외부 링크 깨짐 방지를 위해 redirect 만 유지.
 */
import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ workspace: string }>;
}

export default async function DashboardRedirect({ params }: Props) {
  const { workspace } = await params;
  redirect(`/diag/${workspace}/home`);
}

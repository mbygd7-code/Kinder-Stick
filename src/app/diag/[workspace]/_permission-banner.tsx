/**
 * Server component — 진단 페이지 상단 권한 안내 배너.
 *
 * PIN 세션이 있으면:
 *   - admin: "관리자 — 모든 팀 응답 가능"
 *   - team member: "{팀명} 시각으로 응답하게 됩니다 — 다른 팀 응답은 보기 전용"
 * 없으면:
 *   - "익명 응답 — 가입하면 팀 시각으로 태그됩니다" + 로그인/가입 링크
 */

import { getCurrentProfile } from "@/lib/auth/session";
import { TEAM_LABEL } from "@/lib/auth/pin";
import { LogoutButton } from "./_logout-button";

export async function DiagnosisPermissionBanner() {
  const me = await getCurrentProfile().catch(() => null);

  if (!me) {
    return (
      <section className="border-b border-ink-soft/40">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="label-mono">
            <span className="text-ink-soft">로그인 없이 응답 중</span> —
            <span className="text-ink-soft"> 팀 태그가 붙지 않습니다</span>
          </p>
          <p className="flex gap-3">
            <a
              href="/auth/login?next=/diag"
              className="label-mono hover:text-ink"
            >
              로그인 →
            </a>
            <a href="/auth/signup" className="label-mono hover:text-ink">
              신규 가입 →
            </a>
          </p>
        </div>
      </section>
    );
  }

  if (me.role === "admin") {
    return (
      <section className="border-b-2 border-accent bg-soft-amber/20">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="label-mono">
            <span className="kicker !text-accent mr-2">관리자</span>
            <span className="text-ink">{me.email}</span>
            <span className="text-ink-soft"> · 모든 팀 시각으로 응답 가능</span>
          </p>
          <LogoutButton />
        </div>
      </section>
    );
  }

  const teamLabel = me.team ? TEAM_LABEL[me.team] : "팀 미지정";
  return (
    <section className="border-b border-cobalt/40 bg-soft-cobalt/20">
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-mono">
          <span className="kicker !text-cobalt mr-2">{teamLabel} 시각</span>
          <span className="text-ink-soft">
            응답은 이 팀 시각으로 태그됩니다 · 다른 팀 응답은 보기만 가능
          </span>
        </p>
        <span className="label-mono text-ink-soft">{me.email}</span>
      </div>
    </section>
  );
}

/**
 * /survey/nps/[token]  공개 NPS 설문 응답 페이지.
 *
 * 로그인 불필요. 토큰만 유효하면 응답 가능.
 * Closed 상태 / 잘못된 토큰 / 만료된 설문은 안내 화면.
 */

import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isValidToken } from "@/lib/surveys/token";
import {
  DEFAULT_QUESTION,
  DEFAULT_REASON_LABEL,
  type SurveyRow,
} from "@/lib/surveys/types";
import { NpsForm } from "./_nps-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function NpsPublicPage({ params }: Props) {
  const { token } = await params;
  if (!isValidToken(token)) notFound();

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("kso_surveys")
    .select("id, kind, share_token, title, question, reason_label, status")
    .eq("share_token", token)
    .eq("kind", "nps")
    .maybeSingle();
  if (!data) notFound();

  const survey = data as Pick<
    SurveyRow,
    "id" | "kind" | "share_token" | "title" | "question" | "reason_label" | "status"
  >;

  if (survey.status === "closed") {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center">
          <p className="kicker mb-3">설문 종료</p>
          <h1 className="font-display text-3xl sm:text-4xl leading-tight mb-4">
            이 설문은 종료되었습니다.
          </h1>
          <p className="text-sm leading-relaxed text-ink-soft">
            관리자가 새 설문을 시작하면 새 링크를 받으실 수 있습니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <NpsForm
      token={token}
      title={survey.title}
      question={survey.question || DEFAULT_QUESTION.nps}
      reasonLabel={survey.reason_label || DEFAULT_REASON_LABEL.nps}
    />
  );
}

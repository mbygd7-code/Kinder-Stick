/**
 * /survey/pmf/[token]  공개 Sean Ellis PMF 설문 응답 페이지.
 */

import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isValidToken } from "@/lib/surveys/token";
import {
  DEFAULT_QUESTION,
  DEFAULT_REASON_LABEL,
  type SurveyRow,
} from "@/lib/surveys/types";
import { PmfForm } from "./_pmf-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function PmfPublicPage({ params }: Props) {
  const { token } = await params;
  if (!isValidToken(token)) notFound();

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("kso_surveys")
    .select("id, kind, share_token, title, question, reason_label, status")
    .eq("share_token", token)
    .eq("kind", "pmf")
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
        </div>
      </main>
    );
  }

  return (
    <PmfForm
      token={token}
      title={survey.title}
      question={survey.question || DEFAULT_QUESTION.pmf}
      reasonLabel={survey.reason_label || DEFAULT_REASON_LABEL.pmf}
    />
  );
}

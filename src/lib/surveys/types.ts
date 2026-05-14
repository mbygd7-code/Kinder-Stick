/**
 * Survey 공용 타입 — NPS + Sean Ellis PMF.
 */

export type SurveyKind = "nps" | "pmf";

export const SURVEY_KINDS: SurveyKind[] = ["nps", "pmf"];

export const SURVEY_LABEL: Record<SurveyKind, string> = {
  nps: "NPS (추천 의향)",
  pmf: "PMF (Sean Ellis 40% 테스트)",
};

export const SURVEY_SUB_ITEM_CODE: Record<SurveyKind, string> = {
  nps: "A13.NPS.SCORE",
  pmf: "A2.SE.40",
};

/** 신뢰도 임계값 — 이 수치 미만이면 진단 점수 자동 반영 보류. */
export const MIN_RESPONSES = 30;

/** stale 판정 일수. */
export const STALE_DAYS = 90;

export interface SurveyRow {
  id: string;
  workspace_id: string;
  kind: SurveyKind;
  share_token: string;
  title: string;
  question: string;
  reason_label: string | null;
  status: "active" | "closed";
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface SurveyResponseRow {
  id: string;
  survey_id: string;
  score: number | null; // NPS 0..10
  pmf_choice: 1 | 2 | 3 | null;
  reason: string | null;
  ip_hash: string | null;
  ua_hash: string | null;
  created_at: string;
}

/** 기본 질문 텍스트 — 운영자가 비워두면 사용. */
export const DEFAULT_QUESTION: Record<SurveyKind, string> = {
  nps: "카인더스틱을 동료 교사에게 추천할 가능성은 얼마나 됩니까?",
  pmf: "만약 더 이상 카인더스틱을 쓸 수 없다면 어떤 기분일까요?",
};

export const DEFAULT_REASON_LABEL: Record<SurveyKind, string> = {
  nps: "어떤 점에서 그렇게 평가하셨나요? (선택)",
  pmf: "이유를 한 줄로 적어주세요 (선택)",
};

export const DEFAULT_TITLE = (kind: SurveyKind): string => {
  const d = new Date();
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${y} Q${q} ${kind === "nps" ? "교사 NPS" : "PMF (Sean Ellis)"}`;
};

/** PMF 옵션 정의 — 응답자에게 노출되는 라벨. */
export const PMF_OPTIONS = [
  { value: 1, label: "매우 실망스러울 것이다", tone: "high" as const },
  { value: 2, label: "다소 실망스러울 것이다", tone: "mid" as const },
  { value: 3, label: "실망스럽지 않을 것이다", tone: "low" as const },
];

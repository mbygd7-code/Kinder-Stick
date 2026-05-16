/**
 * 용어 사전 (Term Glossary) — Appendix G 정책.
 *
 * 정책: 모든 UI 라벨·문항·결과 표시는 "평이한 한국어 (전문용어)" 패턴.
 * 직원이 평이한 표현으로 시작하되 괄호의 전문용어로 학습·외부 자료 검색 가능.
 *
 * 사용:
 *   import { GLOSSARY, friendly, withProfessional } from "@/lib/term-glossary";
 *   friendly("PMF")                  // → "제품-시장 적합성"
 *   withProfessional("PMF")          // → "제품-시장 적합성 (PMF · Product-Market Fit)"
 *   GLOSSARY["PMF"].explain          // 호버 풀이용 1-2문장
 *
 *   <TermTooltip term="PMF" />       // 컴포넌트로 직접 렌더
 */

export interface TermEntry {
  /** 평이한 한국어 핵심 표현 (UI 1차 노출) */
  friendly: string;
  /** 전문용어 풀 표기 — 괄호 안에 표시될 부분 */
  professional: string;
  /** 호버 시 보여줄 1–2문장 풀이 */
  explain: string;
  /** (선택) 프레임워크의 세부 항목 — 예: Nielsen 10원칙의 10개 항목.
   * 도움말 popover 에서 번호 매긴 리스트로 표시되어 사용자가 외부 검색 없이
   * 바로 질문을 이해·답변할 수 있게 한다. */
  details?: string[];
  /** 외부 학습 자료 (선택) */
  link?: string;
  /** 카테고리 — 자동 분류용 */
  category?:
    | "framework"
    | "metric"
    | "scoring"
    | "compliance"
    | "ux"
    | "ops";
}

/**
 * 카인더스틱 OS 에서 자주 등장하는 용어 사전.
 * 단어 추가 시 이 파일 한 곳만 수정 → 모든 화면 일괄 반영.
 */
export const GLOSSARY: Record<string, TermEntry> = {
  // ──────────────────────────── Framework / Scoring ─────────────────────
  "Sub-item": {
    friendly: "체크 항목",
    professional: "Sub-item",
    explain: "진단의 가장 작은 측정 단위. 한 문항 = 한 sub-item.",
    category: "framework",
  },
  Domain: {
    friendly: "영역",
    professional: "Domain",
    explain: "여러 체크 항목을 묶은 평가 카테고리 (A1–A14). 12개 영역.",
    category: "framework",
  },
  Tier: {
    friendly: "영향도",
    professional: "Tier (Critical/Important/Supporting)",
    explain: "회사 생존에 미치는 영향 크기. 핵심·중요·보조 3단계.",
    category: "framework",
  },
  Cadence: {
    friendly: "점검 주기",
    professional: "Cadence",
    explain: "이 항목을 얼마나 자주 점검해야 하는지. 매일·주간·월간·분기·반기.",
    category: "framework",
  },
  Belief: {
    friendly: "스스로 평가",
    professional: "Belief Score",
    explain: "본인이 생각하는 우리 회사 점수. 자기 인식 기반.",
    category: "scoring",
  },
  Evidence: {
    friendly: "근거 점수",
    professional: "Evidence Value",
    explain: "실제 측정값·외부 데이터 기반의 객관 점수.",
    category: "scoring",
  },

  // ──────────────────────────── PMF / Activation ─────────────────────
  PMF: {
    friendly: "제품-시장 적합성",
    professional: "PMF · Product-Market Fit",
    explain:
      "사용자가 우리 제품을 진짜로 좋아하고, 없으면 아쉬워하는 정도. 스타트업 생존의 1번 조건.",
    link: "https://www.startupgrind.com/blog/product-market-fit/",
    category: "framework",
  },
  "Sean Ellis 40%": {
    friendly: "사용자 만족도 측정",
    professional: "Sean Ellis 40% 테스트",
    explain:
      "활성 사용자에게 '우리 제품을 못 쓰면 얼마나 아쉬워?' 물어 'Very disappointed' 40%+ 면 PMF 달성으로 판단.",
    link: "https://www.startupgrind.com/blog/the-sean-ellis-pmf-survey/",
    category: "metric",
  },
  "Aha Moment": {
    friendly: "첫 만족 순간",
    professional: "Aha Moment",
    explain:
      "사용자가 우리 제품의 가치를 처음 체감하는 결정적 순간. 예: 알림장 첫 발송 5분 안에.",
    category: "ux",
  },
  Activation: {
    friendly: "첫 사용 흐름",
    professional: "Activation Funnel",
    explain: "가입 → 첫 가치 경험까지의 단계별 전환율.",
    category: "metric",
  },
  Retention: {
    friendly: "유지율",
    professional: "Retention",
    explain: "사용자가 떠나지 않고 계속 쓰는 비율. M1·M3·M6 코호트로 측정.",
    category: "metric",
  },
  Cohort: {
    friendly: "가입 동기 그룹",
    professional: "Cohort",
    explain: "같은 시기에 가입한 사용자 묶음. retention 분석 단위.",
    category: "metric",
  },
  Churn: {
    friendly: "이탈",
    professional: "Churn",
    explain: "사용자가 서비스를 떠나는 비율. retention 의 반대.",
    category: "metric",
  },

  // ──────────────────────────── NPS / CS ─────────────────────
  NPS: {
    friendly: "추천 의향 점수",
    professional: "NPS · Net Promoter Score",
    explain:
      "0–10 점 중 '우리를 추천하시겠나' 답 분포로 산출. promoter(9–10) - detractor(0–6).",
    link: "https://www.netpromoter.com/know/",
    category: "metric",
  },
  NRR: {
    friendly: "고객 매출 유지율",
    professional: "NRR · Net Revenue Retention",
    explain:
      "기존 고객 매출이 1년 후 얼마나 남았는지 (이탈 - 확장). 100% 미만이면 leaky bucket.",
    category: "metric",
  },
  "Stay-Intent": {
    friendly: "머물 의사",
    professional: "Stay-Intent",
    explain: "다음 기간(학기·분기) 에도 계속 쓰겠다는 비율. retention 의 선행 지표.",
    category: "metric",
  },
  Continuation: {
    friendly: "계속 이용률",
    professional: "Continuation Rate",
    explain: "학기·분기 단위로 계속 사용한 비율. 교사 retention 의 단위.",
    category: "metric",
  },
  "Health Score": {
    friendly: "고객 건강 점수",
    professional: "Customer Health Score",
    explain: "(사용 빈도·NPS·로그인) 합산으로 churn 위험을 예측하는 점수.",
    category: "metric",
  },
  QBR: {
    friendly: "분기 점검 미팅",
    professional: "QBR · Quarterly Business Review",
    explain: "Top 고객 대상으로 분기마다 사용 현황·만족도·확장 점검하는 30분 미팅.",
    category: "ops",
  },
  SLA: {
    friendly: "응답 약속",
    professional: "SLA · Service Level Agreement",
    explain: "CS 응답 시간 약속. 예: 24시간 내 1차 답변.",
    category: "ops",
  },

  // ──────────────────────────── Marketing / GTM ─────────────────────
  ICP: {
    friendly: "이상적 고객",
    professional: "ICP · Ideal Customer Profile",
    explain: "우리 제품에 가장 잘 맞는 고객 유형. 예: '서울·경기 4–7년차 어린이집 담임 교사'.",
    category: "framework",
  },
  JTBD: {
    friendly: "고객이 우리를 쓰는 진짜 이유",
    professional: "JTBD · Jobs To Be Done",
    explain: "Christensen 프레임. 고객이 우리 제품을 '고용' 하는 일이 무엇인지 정의.",
    link: "https://hbr.org/2016/09/know-your-customers-jobs-to-be-done",
    category: "framework",
  },
  CAC: {
    friendly: "고객 획득 비용",
    professional: "CAC · Customer Acquisition Cost",
    explain: "유료 고객 1명 얻는 데 든 마케팅·세일즈 비용 평균.",
    category: "metric",
  },
  "CAC Payback": {
    friendly: "광고비 회수 기간",
    professional: "CAC Payback",
    explain: "CAC 가 ARPU 누적으로 회수되는 기간(개월). 24개월 이하 권장.",
    category: "metric",
  },

  // ──────────────────────────── Active Users ─────────────────────
  DAU: {
    friendly: "일간 활성 사용자",
    professional: "DAU · Daily Active Users",
    explain: "하루에 한 번 이상 핵심 액션을 한 사용자 수.",
    category: "metric",
  },
  WAU: {
    friendly: "주간 활성 사용자",
    professional: "WAU · Weekly Active Users",
    explain: "지난 7일 안에 한 번 이상 핵심 액션을 한 사용자 수.",
    category: "metric",
  },
  MAU: {
    friendly: "월간 활성 사용자",
    professional: "MAU · Monthly Active Users",
    explain: "지난 30일 안에 한 번 이상 핵심 액션을 한 사용자 수.",
    category: "metric",
  },
  "WAU/MAU": {
    friendly: "사용 빈도 비율",
    professional: "WAU/MAU Ratio",
    explain: "주간 활성 / 월간 활성. 50% 넘으면 습관화된 제품으로 본다.",
    category: "metric",
  },

  // ──────────────────────────── Goals / OKR ─────────────────────
  OKR: {
    friendly: "회사 목표",
    professional: "OKR · Objectives and Key Results",
    explain: "분기·연간 목표 설정 프레임. Objective (방향) + Key Results (측정).",
    link: "https://www.whatmatters.com/faqs/okr-meaning-definition-example",
    category: "ops",
  },

  // ──────────────────────────── UX / Performance ─────────────────────
  "Core Web Vitals": {
    friendly: "페이지 로딩 성능",
    professional: "Core Web Vitals",
    explain: "Google 이 정한 웹 성능 3대 지표 (LCP·INP·CLS). SEO·UX 모두 영향.",
    link: "https://web.dev/vitals/",
    category: "ux",
  },
  LCP: {
    friendly: "첫 화면이 보이는 시간",
    professional: "LCP · Largest Contentful Paint",
    explain: "페이지에서 가장 큰 요소가 그려지는 시간. 2.5초 이하 권장.",
    category: "ux",
  },
  INP: {
    friendly: "버튼 응답 속도",
    professional: "INP · Interaction to Next Paint",
    explain: "사용자가 클릭·탭한 뒤 화면이 반응하는 시간. 200ms 이하 권장. (FID 의 후속)",
    category: "ux",
  },
  CLS: {
    friendly: "화면 튀는 정도",
    professional: "CLS · Cumulative Layout Shift",
    explain: "페이지 로딩 중 요소가 갑자기 움직이는 양. 0.1 이하 권장.",
    category: "ux",
  },
  WCAG: {
    friendly: "웹 접근성",
    professional: "WCAG 2.2 AA",
    explain:
      "시각·청각 장애인도 사용 가능한지 평가하는 국제 표준. 색대비·키보드 내비·focus 표시 등.",
    link: "https://www.w3.org/WAI/standards-guidelines/wcag/",
    category: "compliance",
  },
  KWCAG: {
    friendly: "한국형 웹 접근성",
    professional: "KWCAG 2.2",
    explain: "WCAG 한국 표준판. 공공·B2G 진입 시 인증 필요.",
    category: "compliance",
  },
  "Design System": {
    friendly: "디자인 시스템",
    professional: "Design System",
    explain: "색·간격·컴포넌트·문구를 표준화한 일관된 UI 자산. Atomic Design 5단계.",
    category: "ux",
  },

  // ──────────────────────────── Compliance / Regulation ─────────────────────
  "KISA ISMS-P": {
    friendly: "한국인터넷진흥원 정보보호 자가점검",
    professional: "KISA ISMS-P 자기점검",
    explain: "개인정보 보호 자기점검 표준. 100점 만점 평가. EdTech 필수 운영.",
    link: "https://isms.kisa.or.kr/",
    category: "compliance",
  },
  PII: {
    friendly: "개인 식별 정보",
    professional: "PII · Personally Identifiable Information",
    explain: "이름·이메일·전화·주민번호 같은 개인 특정 가능한 정보. 보호법 22조의2 대상.",
    category: "compliance",
  },
  "2019 개정 누리과정": {
    friendly: "만 3–5세 누리과정",
    professional: "2019 개정 누리과정",
    explain:
      "교육부·복지부 공동 고시. 만 3–5세 5영역 (신체운동·건강 / 의사소통 / 사회관계 / 예술경험 / 자연탐구). 유아·놀이 중심.",
    category: "compliance",
  },
  "표준보육과정": {
    friendly: "만 0–2세 표준보육과정",
    professional: "제4차 어린이집 표준보육과정",
    explain:
      "보복부 고시 2020-75호. 만 0–2세 6영역 (기본생활 추가). 영아 발달 기반.",
    category: "compliance",
  },
  "어린이집 평가제": {
    friendly: "어린이집 평가제",
    professional: "어린이집 평가제 (4영역 18지표)",
    explain:
      "한국보육진흥원 4년 주기 평가. 보육과정·환경·건강안전·교직원 4영역. 영유아 권리 존중 필수지표 포함.",
    category: "compliance",
  },

  // ──────────────────────────── Team / Culture ─────────────────────
  "Leadership Alignment": {
    friendly: "리더십 정렬",
    professional: "Leadership Alignment",
    explain: "공동 의사결정자 사이의 비전·역할·의사결정·승계 합의 정도. 4점 이하면 위험.",
    category: "ops",
  },
  Westrum: {
    friendly: "팀 정보 흐름 점수",
    professional: "Westrum Culture Score",
    explain:
      "정보 흐름·실패 학습·새 아이디어 환영도 5문항 설문. 60점 미만이면 운영 사고 증가.",
    link: "https://qualitysafety.bmj.com/content/13/suppl_2/ii22",
    category: "ops",
  },
  "Psychological Safety": {
    friendly: "심리적 안전감",
    professional: "Psychological Safety",
    explain: "Edmondson 5문항. 4점 이상이면 실험·실패 학습 활발. 3점 미만이면 1on1 즉시.",
    link: "https://hbr.org/2023/04/what-is-psychological-safety",
    category: "ops",
  },

  // ──────────────────────────── Bayesian Scoring ─────────────────────
  "Failure Probability": {
    friendly: "어려움 가능성",
    professional: "Bayesian Failure Probability",
    explain:
      "6/12개월 안에 회사가 심각한 어려움을 겪을 추정 확률. 비슷한 회사 평균 + 우리 진단으로 보정.",
    category: "scoring",
  },
  Prior: {
    friendly: "비슷한 회사 평균",
    professional: "Prior",
    explain: "베이지안 시작점. 같은 단계 회사들의 통계적 평균 실패율.",
    category: "scoring",
  },
  Posterior: {
    friendly: "우리 회사 보정 후 확률",
    professional: "Posterior Odds",
    explain: "Prior × 우리 진단 결과 보정 → 최종 산출된 확률.",
    category: "scoring",
  },
  LR: {
    friendly: "위험 배수",
    professional: "LR · Likelihood Ratio",
    explain: "특정 신호(빨강 도메인·데이터 노후 등) 가 위험을 몇 배 올리는지 계수.",
    category: "scoring",
  },

  // ──────────────────────────── 카인더스틱 특수 ─────────────────────
  PLC: {
    friendly: "교사 학습 공동체",
    professional: "PLC · Professional Learning Community",
    explain: "교사들이 모여 함께 배우는 공동체. 카인더스틱의 핵심 컨셉.",
    category: "ops",
  },

  // ──────────────────────────── 추가 — 진단 문항에 자주 등장 ─────────
  ROI: {
    friendly: "투자 대비 효과",
    professional: "ROI · Return on Investment",
    explain:
      "교사가 우리 서비스에 쓴 시간·돈 대비 얻은 가치. 영유아 교사 ROI 는 보통 '주당 시간 절약 × 시급 환산'.",
    category: "metric",
  },
  "D1 Activation": {
    friendly: "가입 다음날 활성",
    professional: "D1 Activation Rate",
    explain:
      "신규 가입한 교사가 '가입 다음날' 핵심 액션 (알림장 작성·자료 다운로드 등) 을 한 비율. 영유아 EdTech 기준 D1 >= 30% 가 양호.",
    category: "metric",
  },
  "M3 Retention": {
    friendly: "3개월 후 유지율",
    professional: "M3 Cohort Retention",
    explain:
      "가입 3개월 후에도 활성 사용 중인 교사 비율. 코호트(같은 시기 가입자) 단위로 측정.",
    category: "metric",
  },

  // ──────────────────────────── 영유아 도메인 ─────────────────────
  "어린이집·유치원": {
    friendly: "어린이집·유치원",
    professional: "어린이집(보건복지부) · 유치원(교육부)",
    explain:
      "어린이집은 보건복지부 관할 (만 0–5세 보육), 유치원은 교육부 관할 (만 3–5세 교육). 평가·규제 체계가 다름.",
    category: "compliance",
  },
  누리과정: {
    friendly: "누리과정",
    professional: "2019 개정 누리과정",
    explain:
      "만 3–5세 공통 교육과정. 신체·의사소통·사회관계·예술경험·자연탐구 5개 영역. 어린이집·유치원 모두 적용.",
    category: "compliance",
  },
  평가제: {
    friendly: "어린이집 평가제",
    professional: "어린이집 평가제 (보건복지부)",
    explain:
      "보건복지부가 3년 주기로 진행하는 어린이집 평가. 4영역 18지표. 결과는 부모·교사 신뢰에 직접 영향.",
    category: "compliance",
  },
  KPI: {
    friendly: "핵심 성과 지표",
    professional: "KPI · Key Performance Indicator",
    explain: "이 한 숫자만 봐도 '잘 되고 있나' 알 수 있는 핵심 측정 항목.",
    category: "metric",
  },
  RAG: {
    friendly: "외부 자료 참조 검색",
    professional: "RAG · Retrieval-Augmented Generation",
    explain:
      "AI 가 답변하기 전에 외부 자료(누리과정 원문·KISA 가이드 등) 를 먼저 검색해서 근거 있게 답하도록 하는 기법.",
    category: "framework",
  },
  PIPA: {
    friendly: "개인정보보호법",
    professional: "PIPA · Personal Information Protection Act",
    explain:
      "한국 개인정보 보호 법령. 영유아 정보는 만 14세 미만 특별 조항(22조의 2) 으로 더 엄격.",
    category: "compliance",
  },

  // ──────────────────────────── UX / Audit / Heuristics ─────────────
  Nielsen: {
    friendly: "Nielsen 사용성 10원칙",
    professional: "Nielsen 10 Usability Heuristics",
    explain:
      "Jakob Nielsen 이 1994년에 정리한 UI 설계의 10가지 원칙. 각 원칙으로 화면을 1–5점 채점해 사용성을 진단한다 (10원칙 × 5점 = 50점 만점).",
    details: [
      "시스템 상태 가시성 — 지금 무슨 일이 일어나는지 사용자에게 즉시 알려준다 (로딩·진행률·저장 완료 등).",
      "현실 세계와의 일치 — 사용자 언어로 말한다 (전문용어 X, 익숙한 메타포 O).",
      "사용자 통제·자유 — 실수해도 쉽게 되돌릴 수 있다 (취소·뒤로가기·되돌리기).",
      "일관성·표준 — 같은 행동은 같은 결과를. 플랫폼 관습을 따른다.",
      "오류 방지 — 오류가 나기 전에 막는다 (확인 단계·기본값·자동완성).",
      "기억보다 인식 — 사용자가 외우게 하지 말고 보여준다 (옵션 노출·최근 항목).",
      "유연성·효율 — 초보자엔 쉽게, 숙련자엔 단축키·매크로 제공.",
      "심미·미니멀 — 꼭 필요한 정보만. 부가 정보는 시각적으로 약하게.",
      "오류 인식·진단·복구 — 오류 메시지는 평이한 말로, 원인과 해결책을 함께.",
      "도움말·문서 — 필요하지 않게 설계하되, 필요할 땐 검색·맥락에 맞게 제공.",
    ],
    link: "https://www.nngroup.com/articles/ten-usability-heuristics/",
    category: "ux",
  },
  audit: {
    friendly: "점검·감사",
    professional: "Audit",
    explain:
      "정해진 기준(체크리스트·표준) 으로 현재 상태를 객관적으로 평가하는 절차. 예: '사용성 audit' = 화면을 10가지 원칙으로 채점.",
    category: "ops",
  },

  // ──────────────────────────── Engineering / DevOps ─────────────────
  DORA: {
    friendly: "DORA 4대 지표",
    professional: "DORA · DevOps Research and Assessment",
    explain:
      "엔지니어링 성과를 측정하는 4지표: 배포 빈도·리드 타임·변경 실패율·복구 시간. Google Cloud DORA 리포트 기준.",
    link: "https://dora.dev/",
    category: "metric",
  },
  "Lean Startup": {
    friendly: "린 스타트업",
    professional: "Lean Startup",
    explain:
      "Eric Ries 의 방법론. '만들고-측정하고-배운다(Build-Measure-Learn)' 사이클로 가설을 빠르게 검증.",
    link: "https://theleanstartup.com/",
    category: "framework",
  },
  "Build-Measure-Learn": {
    friendly: "만들고-측정-학습 사이클",
    professional: "Build–Measure–Learn",
    explain:
      "Lean Startup 의 핵심 루프. MVP 만들기 → 사용자 데이터 측정 → 가설 학습 → 다음 사이클.",
    category: "framework",
  },
  "Shape Up": {
    friendly: "Shape Up 개발 사이클",
    professional: "Shape Up (Basecamp)",
    explain:
      "Basecamp 가 만든 6주 단위 제품 개발 방법론. 정해진 시간 안에 범위를 조정하며 마무리.",
    link: "https://basecamp.com/shapeup",
    category: "framework",
  },
  AARRR: {
    friendly: "해적 지표 5단계",
    professional: "AARRR · Pirate Metrics",
    explain:
      "Dave McClure 의 스타트업 분석 프레임. Acquisition → Activation → Retention → Revenue → Referral 5단계 깔때기.",
    category: "framework",
  },

  // ──────────────────────────── Team / Org ─────────────────────────
  "Lencioni 5 Dysfunctions": {
    friendly: "팀 5가지 역기능",
    professional: "Lencioni 5 Dysfunctions of a Team",
    explain:
      "Patrick Lencioni 모델. 신뢰 부재 → 갈등 회피 → 헌신 부재 → 책임 회피 → 결과 무관심 5단계 누적 실패. 팀 정렬 진단의 표준.",
    category: "ops",
  },
  Edmondson: {
    friendly: "심리적 안전감 (Edmondson)",
    professional: "Amy Edmondson · Psychological Safety",
    explain:
      "Harvard 교수 Edmondson 의 연구. 팀원이 실수·반대 의견을 두려움 없이 말할 수 있는 분위기 = 학습·혁신의 전제 조건.",
    link: "https://hbr.org/2023/04/what-is-psychological-safety",
    category: "ops",
  },
  Christensen: {
    friendly: "JTBD 창시자 Christensen",
    professional: "Clayton Christensen",
    explain:
      "Harvard 교수, '혁신의 딜레마'와 JTBD(Jobs To Be Done) 이론의 창시자.",
    category: "framework",
  },

  // ──────────────────────────── 우선순위 / 의사결정 ────────────────
  RICE: {
    friendly: "RICE 우선순위 점수",
    professional: "RICE Score (Reach·Impact·Confidence·Effort)",
    explain:
      "Intercom 이 만든 백로그 우선순위 공식. (Reach × Impact × Confidence) ÷ Effort. 직관 대신 숫자로 비교.",
    category: "framework",
  },
  ICE: {
    friendly: "ICE 점수",
    professional: "ICE Score (Impact·Confidence·Ease)",
    explain:
      "Sean Ellis 그로스 해킹 우선순위. Impact × Confidence × Ease 평균. RICE 보다 단순.",
    category: "framework",
  },
  MVP: {
    friendly: "최소 기능 제품",
    professional: "MVP · Minimum Viable Product",
    explain:
      "가설을 검증할 수 있는 최소한의 기능만 갖춘 초기 버전. 빠르게 시장 반응을 보고 학습.",
    category: "framework",
  },

  // ──────────────────────────── 매출 / SaaS ────────────────────────
  MRR: {
    friendly: "월 반복 매출",
    professional: "MRR · Monthly Recurring Revenue",
    explain:
      "구독·반복 결제로 매월 안정적으로 들어오는 매출. SaaS 의 가장 기본 KPI.",
    category: "metric",
  },
  ARR: {
    friendly: "연 반복 매출",
    professional: "ARR · Annual Recurring Revenue",
    explain: "MRR × 12. 연간 기준 반복 매출 규모.",
    category: "metric",
  },
  LTV: {
    friendly: "고객 생애 가치",
    professional: "LTV · Customer Lifetime Value",
    explain:
      "한 고객이 평생 동안 우리에게 지불할 매출 합계 추정. CAC 와 비교해 LTV/CAC ≥ 3 을 권장.",
    category: "metric",
  },
  CSAT: {
    friendly: "고객 만족도 점수",
    professional: "CSAT · Customer Satisfaction Score",
    explain:
      "특정 경험 직후 '얼마나 만족하셨나요?'(1–5점) 평균. NPS 가 충성도라면 CSAT 는 즉각적 만족도.",
    category: "metric",
  },

  // ──────────────────────────── 데이터 분석 ───────────────────────
  Funnel: {
    friendly: "전환 깔때기",
    professional: "Conversion Funnel",
    explain:
      "사용자가 가입 → 활성 → 구매 등 단계별로 좁아지는 흐름. 각 단계 전환율을 측정하면 어디서 막히는지 보임.",
    category: "metric",
  },
  CRM: {
    friendly: "고객 관계 관리 시스템",
    professional: "CRM · Customer Relationship Management",
    explain:
      "고객 정보·소통 이력·매출을 한 곳에서 관리하는 도구. 예: HubSpot, Salesforce.",
    category: "ops",
  },
  GA4: {
    friendly: "Google Analytics 4",
    professional: "GA4",
    explain:
      "Google 의 웹/앱 행동 분석 도구 최신판. 이벤트 기반으로 사용자 흐름 추적.",
    category: "metric",
  },
  Mixpanel: {
    friendly: "Mixpanel 사용자 분석 도구",
    professional: "Mixpanel",
    explain:
      "이벤트 기반 제품 분석 SaaS. cohort retention·funnel 분석에 강함.",
    category: "metric",
  },
  Amplitude: {
    friendly: "Amplitude 사용자 분석 도구",
    professional: "Amplitude",
    explain:
      "이벤트·세션 기반 제품 분석 SaaS. 사용자 여정·retention·실험 분석에 사용.",
    category: "metric",
  },
};

/**
 * 키 정규화 (대소문자·공백·하이픈 무시).
 */
function normalize(key: string): string {
  return key.trim().toLowerCase().replace(/[\s\-_·]+/g, "");
}

// 정규화된 키로 빠른 lookup 맵 빌드 (모듈 로드 시 1회)
const NORMALIZED_INDEX = new Map<string, string>();
for (const key of Object.keys(GLOSSARY)) {
  NORMALIZED_INDEX.set(normalize(key), key);
}

/**
 * 용어 검색 — 대소문자·공백·하이픈 무시.
 */
export function findTerm(query: string): TermEntry | null {
  const direct = GLOSSARY[query];
  if (direct) return direct;
  const norm = normalize(query);
  const canonicalKey = NORMALIZED_INDEX.get(norm);
  return canonicalKey ? GLOSSARY[canonicalKey] : null;
}

/**
 * 평이한 한국어만 반환.
 */
export function friendly(term: string): string {
  return findTerm(term)?.friendly ?? term;
}

/**
 * "평이한 한국어 (전문용어)" 형태 반환.
 * 매칭 안 되면 원문 그대로.
 */
export function withProfessional(term: string): string {
  const entry = findTerm(term);
  if (!entry) return term;
  return `${entry.friendly} (${entry.professional})`;
}

/**
 * 호버 풀이 문장 반환.
 */
export function explain(term: string): string | null {
  return findTerm(term)?.explain ?? null;
}

/**
 * 텍스트 내 등장하는 모든 사전 단어 자동 탐지.
 * `_term-tooltip.tsx` 가 텍스트 노드를 분석해 hover 풀이 노출에 사용.
 */
export function detectTermsInText(text: string): Array<{
  term: string;
  entry: TermEntry;
  startIndex: number;
  endIndex: number;
}> {
  const matches: Array<{
    term: string;
    entry: TermEntry;
    startIndex: number;
    endIndex: number;
  }> = [];
  for (const key of Object.keys(GLOSSARY)) {
    const entry = GLOSSARY[key];
    // friendly 또는 professional 둘 다 탐지
    for (const variant of [entry.friendly, entry.professional, key]) {
      const re = new RegExp(
        variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi",
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          term: key,
          entry,
          startIndex: m.index,
          endIndex: m.index + variant.length,
        });
      }
    }
  }
  // 중복 제거 + 시작 위치 정렬
  const dedupe = new Map<string, (typeof matches)[number]>();
  for (const m of matches) {
    const k = `${m.startIndex}:${m.endIndex}`;
    if (!dedupe.has(k)) dedupe.set(k, m);
  }
  return Array.from(dedupe.values()).sort(
    (a, b) => a.startIndex - b.startIndex,
  );
}

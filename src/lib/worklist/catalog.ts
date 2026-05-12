/**
 * Worklist Catalog — canonical task list per team, organized by lifecycle phase.
 *
 * 진단을 이미 마쳤다는 가정 하에, 진단 메타(응답·재시행·인용) 업무는 제외.
 * 우리 회사가 시장에서 '다른 회사 다 해본 만큼' 운영하기 위한 실제 업무를
 * 4 phases × 6 teams 매트릭스로 정리.
 *
 * Auto-derive 가능 항목은 `auto: true` + 별도 deriver에서 판정.
 * 수동 조작은 localStorage(`worklist:{workspace}:{taskId}`)에 저장.
 *
 * 일부 업무는 `escalation_hint` 로 회사 목표(연말 회원 / 월 목표 / PLC 목표 등)에
 * 따라 횟수·강도가 어떻게 가속되어야 하는지 가이드를 함께 제공.
 */

export type Team =
  | "director"
  | "planning"
  | "design"
  | "engineering"
  | "operations"
  | "marketing";

export type Phase = "foundation" | "launch" | "growth" | "ops";

/**
 * 고객여정(Customer Journey) — 마케팅 퍼널 + 리텐션 + 그로스를 통합한 단계.
 * 회사가 어느 고객 경험 단계에 영향을 주는 업무인지를 표시.
 */
export type FunnelStage =
  | "awareness" // 인지 — 브랜드·콘텐츠·SEO·페르소나·메시지
  | "acquisition" // 획득 — 랜딩·채널·가입·전환 funnel 진입
  | "activation" // 활성화 — 온보딩·Aha moment·D1/D7
  | "retention" // 유지 — 습관화·CS·NPS·M3 cohort
  | "revenue" // 매출 — 유료 전환·가격·CAC payback
  | "referral" // 추천 — referral·입소문·NPS 활용
  | "expansion" // 확장 — NRR·QBR·upsell·PLC 커뮤니티
  | "internal"; // 내부 — 인프라·보안·팀·재무·운영 백오피스

export type Cadence =
  | "once"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "annual"
  | "as_needed";

export type Tier = "must" | "conditional" | "recurring";

export type AutoRule =
  | { kind: "workspace_exists" }
  | { kind: "respondents_at_least"; n: number }
  | { kind: "diagnosis_complete" }
  | { kind: "domain_responded"; code: string }
  | { kind: "evidence_recorded_for"; code: string }
  | { kind: "any_action_with_owner_for_critical_red" }
  | { kind: "all_red_critical_have_action" }
  | { kind: "no_overdue_actions" }
  | { kind: "actions_verified_at_least"; n: number }
  | { kind: "coach_session_for"; code: string }
  | { kind: "coach_session_resolved_for"; code: string }
  | { kind: "external_expert_called_if_severity_4" }
  | { kind: "kpi_source_connected"; source: string }
  | { kind: "kpi_recent_within_days"; metric: string; days: number }
  | { kind: "diagnosis_within_days"; days: number }
  | { kind: "manual_only" };

export interface Task {
  id: string;
  team: Team;
  phase: Phase;
  title: string;
  why: string;
  cadence: Cadence;
  tier: Tier;
  auto: AutoRule;
  domain?: string;
  hint?: string;
  /** 회사 목표(목표 패널)와 연계해 횟수·강도가 어떻게 가속되어야 하는지 가이드 */
  escalation_hint?: string;
  /** 이 업무가 영향 주는 고객여정 단계. 명시 안 하면 FUNNEL_BY_TASK_ID에서 조회. */
  funnel_stage?: FunnelStage;
  /** AI 도구·역량으로 가속할 수 있다면 그 방법을 한 줄로 (없으면 미표기). */
  ai_leverage?: string;
  /**
   * 직원이 호버 시 보는 평이한 설명 (4-6줄): 무엇을 하는지 + 어떻게 하는지 + 무엇이 ‘완료’의 기준인지.
   * 비어 있으면 why를 fallback으로 사용.
   */
  description?: string;
  /**
   * 이 업무를 ‘완료’로 표시했을 때 진단 점수가 가산되는 도메인 코드 목록.
   * 도메인 점수는 0~100 → +impact_points 만큼 boost된 후 재계산.
   * 명시 안 하면 task.domain 한 항목으로 가정.
   */
  boost_domains?: string[];
  /** 1개 업무 완료 시 boost_domains 각 도메인에 더해질 점수. 기본 8. */
  boost_points?: number;
  /**
   * 이 task 가 가장 우선시 되어야 하는 제품 출시 단계.
   * 없으면 모든 stage 에서 동일 가중치. 우선순위 점수 산정에 사용.
   */
  stage_relevance?: import("@/lib/scoring").Stage[];
}

// ============================================================
// Labels & metadata
// ============================================================

export const TEAM_LABEL: Record<Team, string> = {
  director: "Director / 대표",
  planning: "기획팀",
  design: "디자인팀",
  engineering: "개발팀",
  operations: "운영팀",
  marketing: "마케팅팀",
};

export const TEAM_SUBTITLE: Record<Team, string> = {
  director: "정렬·결정·자금·외부 커뮤니케이션",
  planning: "PMF·고객 발견·우선순위·로드맵",
  design: "활성화·유지·NPS·온보딩",
  engineering: "속도·AI 역량·보안·규제",
  operations: "응답률·CS·NRR·액션 follow-through",
  marketing: "GTM·채널·메시지·브랜드",
};

export const TEAM_ORDER: Team[] = [
  "director",
  "planning",
  "design",
  "engineering",
  "operations",
  "marketing",
];

export const PHASE_LABEL: Record<Phase, string> = {
  foundation: "사전 준비",
  launch: "시장 진입",
  growth: "성장",
  ops: "운영 안정화",
};

export const PHASE_DESC: Record<Phase, string> = {
  foundation: "회사·제품·팀의 기초가 무너지지 않도록 다지는 단계",
  launch: "첫 PMF·첫 매출까지, 시장에서 살아남기 위한 단계",
  growth: "PMF 이후 채널·팀·매출 확장 단계",
  ops: "정기 운영 모드 — 누락 없는 점검·재측정·개선 루프",
};

export const PHASE_ORDER: Phase[] = ["foundation", "launch", "growth", "ops"];

export const CADENCE_LABEL: Record<Cadence, string> = {
  once: "1회",
  weekly: "주간",
  monthly: "월간",
  quarterly: "분기",
  semi_annual: "반기",
  annual: "연간",
  as_needed: "수시",
};

export const TIER_LABEL: Record<Tier, string> = {
  must: "필수",
  conditional: "조건부",
  recurring: "정기",
};

export const FUNNEL_LABEL: Record<FunnelStage, string> = {
  awareness: "인지",
  acquisition: "획득",
  activation: "활성화",
  retention: "유지",
  revenue: "매출",
  referral: "추천",
  expansion: "확장",
  internal: "내부",
};

export const FUNNEL_DESC: Record<FunnelStage, string> = {
  awareness: "고객이 우리를 알게 되는 단계",
  acquisition: "관심 → 가입까지의 전환 단계",
  activation: "첫 가치 경험 (Aha moment)",
  retention: "습관화·재방문·만족도",
  revenue: "유료 전환·결제·CAC payback",
  referral: "입소문·추천·NPS 활용",
  expansion: "기존 고객 확장 (NRR·PLC·QBR)",
  internal: "백오피스 (인프라·보안·팀·재무)",
};

export const FUNNEL_ORDER: FunnelStage[] = [
  "awareness",
  "acquisition",
  "activation",
  "retention",
  "revenue",
  "referral",
  "expansion",
  "internal",
];

// ============================================================
// CATALOG — ~130 tasks (진단 메타 제외, PLC·성장·AI 활용 포함)
// ============================================================

export const TASKS: Task[] = [
  // ════════════════════════════════════════════════════════════
  //  DIRECTOR / 대표
  // ════════════════════════════════════════════════════════════
  // ── Foundation ─────────────────────────────────────────────
  {
    id: "dir.f.mission",
    team: "director",
    phase: "foundation",
    title: "회사 미션·비전 1-pager 작성 + 팀 공유",
    why: "팀이 같은 방향을 보지 않으면 우선순위 갈등이 매주 반복됩니다.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "dir.f.annual_targets",
    team: "director",
    phase: "foundation",
    title: "연간 회원·매출·PLC 목표 수립 + 공유",
    why: "목표 없이는 worklist가 모든 팀에게 ‘자율 권장’ — 목표가 강도를 결정.",
    cadence: "annual",
    tier: "must",
    auto: { kind: "manual_only" },
    hint: "위 목표 패널에서 입력 → 팀별 worklist 강도 자동 가속",
  },
  {
    id: "dir.f.plc_business_model",
    team: "director",
    phase: "foundation",
    title: "PLC(학습공동체) 사업 모델·가격 정책 결정",
    why: "PLC는 신규 카테고리 — 무료/리더 보상/유료 전환 정책 미정 시 운영팀 마비.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },

  // ── Launch ─────────────────────────────────────────────────
  {
    id: "dir.l.assign_owners",
    team: "director",
    phase: "launch",
    title: "위험 영역 책임자 지정 (분기 검토)",
    why: "위험 영역에 책임자가 없으면 ‘아무도 안 함’으로 수렴 — 분기마다 명시.",
    cadence: "quarterly",
    tier: "must",
    auto: { kind: "all_red_critical_have_action" },
  },
  {
    id: "dir.l.weekly_priority",
    team: "director",
    phase: "launch",
    title: "이번 주 우선순위 검토 + 리소스 배분",
    why: "결정·자금·인력을 매주 한 번 정렬 안 하면 팀 별로 다른 우선순위로 진행.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "no_overdue_actions" },
  },
  {
    id: "dir.l.go_to_market_thesis",
    team: "director",
    phase: "launch",
    title: "Go-to-Market 가설 1장 + 검증 KPI",
    why: "GTM 가설 없이 채널 선택은 ‘예산 분산’ — 실패도 학습이 안 됨.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },

  // ── Growth ─────────────────────────────────────────────────
  {
    id: "dir.g.monthly_revenue_review",
    team: "director",
    phase: "growth",
    title: "월간 매출·CAC·NRR 대시보드 점검",
    why: "이 3개 지표 동시 점검 안 하면 ‘성장’과 ‘밑 빠진 독’ 구분 불가.",
    cadence: "monthly",
    tier: "must",
    domain: "A5",
    auto: { kind: "manual_only" },
    escalation_hint: "월 목표 300명+ 시 격주 점검으로 가속 권장",
  },
  {
    id: "dir.g.key_talent",
    team: "director",
    phase: "growth",
    title: "핵심인재 ‘이직 의향(stay-intent)’ 분기 익명 측정",
    why: "핵심 1명이 떠나면 그 분기 매출이 보통 15% 떨어집니다. 떠나기 전에 ‘얼마나 머물 생각인지’를 익명으로 측정해야 미리 손쓸 수 있습니다.",
    description:
      "ⓘ 용어 풀이\nStay-intent = 직원이 ‘앞으로 1–2년 안에 회사를 떠날 가능성이 얼마나 되는가’를 5점 척도로 응답한 점수.\nWestrum 문화 = ‘잘못 보고하면 처벌받는가 vs 학습으로 받는가’를 측정. Pathological(처벌형)·Bureaucratic(절차형)·Generative(학습형)로 분류.\n\n⚙ 어떻게 하는가\n분기마다 익명 설문 (Officevibe·Lattice·자체 Typeform) — 5 질문: ① stay-intent 5점 ② 의사결정 투명도 ③ 실수 보고 안전감 ④ 매니저 신뢰 ⑤ 자유 의견. 50% 미만이면 1:1 stay 인터뷰 즉시 진행.\n\n✔ 완료 기준\n분기마다 응답률 80%+ + Westrum·stay 점수 시계열 시트 + 50% 미만 인재 식별 시 1:1 인터뷰 30일 안에 완료.",
    cadence: "quarterly",
    tier: "must",
    domain: "A11",
    auto: { kind: "evidence_recorded_for", code: "A11" },
  },
  {
    id: "dir.g.external_expert",
    team: "director",
    phase: "growth",
    title: "외부 전문가 호출 결정 (긴급 이슈)",
    why: "법률·세무·규제는 내부 판단으로 무리 — 회사 리스크 직결.",
    cadence: "as_needed",
    tier: "conditional",
    auto: { kind: "external_expert_called_if_severity_4" },
  },

  // ── Ops ────────────────────────────────────────────────────
  {
    id: "dir.o.monthly_report",
    team: "director",
    phase: "ops",
    title: "월간 운영 리포트 발송 (팀·이해관계자)",
    why: "월간 진행 상황·교사 사용 추이·운영 이슈를 한 문서로 정리 — 의사결정 누락과 정보 비대칭을 방지합니다.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "dir.o.year_review",
    team: "director",
    phase: "ops",
    title: "연간 회고 + 다음 해 계획 (1월)",
    why: "1년 단위 변곡점 자기 검토 없으면 ‘조용한 stagnation’이 1-2년 누적.",
    cadence: "annual",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "dir.o.target_review",
    team: "director",
    phase: "ops",
    title: "분기 목표 달성도 점검 + 재조정",
    why: "분기마다 ‘목표 vs 현재’ 격차 확인 안 하면 1년 끝에 50% 달성한 채로 발견.",
    cadence: "quarterly",
    tier: "must",
    auto: { kind: "manual_only" },
    hint: "위 목표 패널의 진행률 기반",
  },

  // ════════════════════════════════════════════════════════════
  //  기획팀 / PLANNING
  // ════════════════════════════════════════════════════════════
  // ── Foundation ─────────────────────────────────────────────
  {
    id: "plan.f.icp_one_liner",
    team: "planning",
    phase: "foundation",
    title: "ICP(이상적 고객) 한 문장 정의",
    why: "‘우리는 _를 위한 _를 만든다’를 한 문장으로 못 쓰면 마케팅·제품·세일즈가 서로 다른 고객을 보고 일하게 됩니다.",
    description:
      "ⓘ 용어 풀이\nICP = Ideal Customer Profile = ‘이상적 고객 정의’. 모든 고객이 아니라 우리가 가장 잘 도와줄 수 있는 고객의 특징(직무·기관 유형·고민)을 1–2 문장으로 좁혀 쓴 문서.\n\n⚙ 어떻게 하는가\n‘우리는 [어떤 사람/조직] 중 [어떤 상황에 처한 사람]을 위해 [어떤 일을 더 쉽게] 만든다’ 형식으로 작성. 예: ‘우리는 5–7세 누리과정 운영 교사 중 학급 운영 시간을 줄이고 싶어하는 분들을 위해 활동 자료 준비를 자동화한다’.\n\n✔ 완료 기준\n팀 전원이 ICP 한 문장을 외워서 말할 수 있고, PRD·랜딩·세일즈 메일에 같은 문장이 인용되면 완료.",
    cadence: "quarterly",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.f.competitor_mapping",
    team: "planning",
    phase: "foundation",
    title: "경쟁사 1차 매핑 + 차별화 포인트 문서화",
    why: "경쟁 인지 없이는 메시지·기능·가격 모두 ‘우연’에 의존.",
    cadence: "once",
    tier: "must",
    domain: "A14",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.f.mom_test_script",
    team: "planning",
    phase: "foundation",
    title: "사용자 인터뷰 표준 스크립트 — Mom Test 방식",
    why: "사용자에게 ‘이거 좋을 것 같나요?’를 물으면 누구나 ‘좋다’고 답합니다(엄마처럼). 의견 대신 과거의 실제 행동을 물어야 거짓 정보가 안 섞입니다.",
    description:
      "ⓘ 용어 풀이\nMom Test = Rob Fitzpatrick의 인터뷰 기법. ‘엄마조차 거짓말 못 하게 묻는 법’. 사용자의 의견·예상이 아닌 과거의 실제 행동·돈 쓴 기록·시간 쓴 기록을 묻는다.\n\n⚙ 어떻게 하는가\n금지: ‘이런 거 있으면 살 거예요?’, ‘이거 좋아 보여요?’\n좋은 질문: ‘마지막으로 이 문제 겪었을 때 뭘 했어요?’, ‘그때 얼마나 시간/돈을 썼어요?’, ‘다른 어떤 방법을 써봤고 왜 그만뒀어요?’\n\n✔ 완료 기준\n팀이 공유하는 인터뷰 스크립트 v1 (Notion·Google Docs 1장) + 의견 질문 0개 + 행동 질문 5개 이상 + 인터뷰 가이드 1페이지 셋업.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.f.plc_persona",
    team: "planning",
    phase: "foundation",
    title: "PLC 교사 리더 페르소나 정의",
    why: "교사 리더(1인)가 5–10명 커뮤니티를 ‘운영’할 수 있는지가 PLC 성공의 90%.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.f.plc_playbook",
    team: "planning",
    phase: "foundation",
    title: "PLC 운영 매뉴얼 v1 (모임 주기·콘텐츠·KPI)",
    why: "리더가 자기만의 방식으로 운영하면 PLC 50개 → 50가지 품질 — 측정·개선 불가.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.f.buyer_segment_split",
    team: "planning",
    phase: "foundation",
    title: "교사 결정자 구매 흐름 2가지 정의 (개인 결제 · 기관 결제)",
    why: "교사가 결정자라는 점은 같아도, ‘교사 본인 카드로 결제하는 개인 구매자’와 ‘기관 예산으로 일괄 구매(원장이 결제 승인)되는 교사’는 구매 사이클과 검증 기준이 다릅니다. 두 흐름을 분리해야 메시지와 가격이 맞춰집니다.",
    description:
      "두 구매 흐름의 1장 페르소나 도큐먼트: ① 교사 개인 결제 (월 1–3만원 자비, 본인 성장·학급 운영 효율 동기, 빠른 의사결정) ② 교사 + 기관 결제 (교사가 도입을 결정·요청 → 원장 결제 승인, 분기·연간 예산, 평가제·누리과정 부합 검증, 1–2개월 의사결정). 각 흐름의 ‘구매 trigger / 검증 질문 / 거부 이유 / 추천 채널’ 4 필드 채우면 완료.",
    cadence: "once",
    tier: "must",
    domain: "A3",
    auto: { kind: "manual_only" },
    boost_domains: ["A3", "A1"],
  },

  // ── Launch ─────────────────────────────────────────────────
  {
    id: "plan.l.jtbd_interview",
    team: "planning",
    phase: "launch",
    title: "사용자 인터뷰 8명 — 우리 제품이 어떤 ‘일’을 해결하는지 파악",
    why: "사용자는 제품을 사는 게 아니라 ‘일을 해결하기 위해 고용’합니다. 그 일이 무엇인지 모르면 PMF는 운에 맡기는 것.",
    description:
      "최근 가입자 8명을 1:1 30분 인터뷰. 핵심 질문 3개: ① 우리를 쓰기 직전 어떤 상황이었나요? ② 다른 어떤 방법을 써봤고 왜 그만뒀나요? ③ 우리를 쓰면서 가장 변한 것은? 의견·기대를 묻지 말고 과거 행동을 물어봅니다(Mom Test). 8명 인터뷰 후 ‘공통 trigger 상황’ + ‘공통 frustration’ + ‘공통 desired outcome’을 1장으로 정리하면 완료.",
    cadence: "as_needed",
    tier: "conditional",
    domain: "A1",
    auto: { kind: "coach_session_for", code: "A1" },
  },
  {
    id: "plan.l.sean_ellis",
    team: "planning",
    phase: "launch",
    title: "PMF 적합성 측정 — ‘이 서비스 없어지면 매우 실망’ 비율 (분기, 응답 30명+)",
    why: "‘매우 실망’ 응답이 40% 이상이면 시장이 우리 제품을 진심으로 원한다는 신호입니다. 25% 미만이면 우리 서비스가 누구를 위한 것인지 아직 모른다는 뜻.",
    description:
      "최근 30일 활성 사용자 30명 이상에게 한 가지만 묻습니다: ‘이 서비스가 내일 사라진다면?’ — (1) 매우 실망 (2) 약간 실망 (3) 실망하지 않음. ‘매우 실망’ 비율을 셉니다. 40%+면 PMF 도달, 25–39%면 아직 못 미친 상태로 핵심 세그먼트 추가 인터뷰 필요, 25% 미만이면 메시지·기능·세그먼트 중 결정적 결함이 있어 재정의 필요. Typeform/Tally로 5분이면 셋업 가능.",
    cadence: "quarterly",
    tier: "must",
    domain: "A2",
    auto: { kind: "evidence_recorded_for", code: "A2" },
    stage_relevance: ["open_beta", "ga_early"],
  },
  {
    id: "plan.l.aha_define",
    team: "planning",
    phase: "launch",
    title: "Aha moment(첫 깨달음 순간) 정량 정의",
    why: "사용자가 ‘아 이거 쓸만하네’를 느끼는 순간을 측정 가능한 행동으로 정의해야 onboarding을 최적화할 수 있습니다.",
    description:
      "ⓘ 용어 풀이\nAha moment = 사용자가 우리 서비스의 가치를 처음 ‘느끼는’ 순간. Facebook은 ‘10일 안에 친구 7명’을, Slack은 ‘팀이 메시지 2,000개 주고받음’을 Aha로 정의.\n\n⚙ 어떻게 하는가\n장기 활성 사용자(retain) vs 이탈자(churn)의 첫 7일 행동을 비교. 두 그룹을 가르는 ‘하나의 행동 + 횟수 + 시간’을 찾아 정의. 예: ‘가입 후 5분 안에 첫 진단 응답 1개 제출’.\n\n✔ 완료 기준\n측정 가능한 한 문장으로 Aha 정의 + 신규 사용자 중 Aha 도달 비율(D1) 매일 측정 시작 + 도달율 목표 60%+.",
    cadence: "once",
    tier: "must",
    domain: "A4",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.l.user_interviews",
    team: "planning",
    phase: "launch",
    title: "사용자 인터뷰 월 5건 루틴 (PM이 직접)",
    why: "PM이 사용자를 직접 만나지 않으면 PRD가 추측으로 채워집니다. 슬랙·CS 티켓·설문은 ‘선별된 정보’ — 직접 만나야 진짜 맥락이 나옵니다.",
    description:
      "ⓘ 용어 풀이\nPM = Product Manager.\nPRD = Product Requirements Document = 제품 요구사항 문서.\n사용자 인터뷰 = 실제 사용자(또는 잠재 사용자) 1:1 대화. ‘의견’이 아닌 ‘과거 행동’을 묻는다 (Mom Test).\n\n⚙ 어떻게 하는가\n월 시작 첫 주에 인터뷰 5건 일정 잡기. 대상: 신규 가입자 2 + 활성 사용자 2 + 이탈자 1. 각 30분, 줌 또는 전화. 표준 스크립트 사용 (foundation phase에서 만든 Mom Test 스크립트). 인터뷰 후 24시간 안에 노트 정리 → ‘이번 달 발견 5가지’를 PM 회의에서 공유.\n\n✔ 완료 기준\n매월 5건 + 인터뷰 노트 archive + 월간 ‘발견 사항’ 문서가 PRD에 인용되는 흐름.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    escalation_hint: "월 목표 500명+ 시 월 10건으로 가속",
  },
  {
    id: "plan.l.smart_action_24h",
    team: "planning",
    phase: "launch",
    title: "위험 영역 SMART 액션 채택 (24시간 내)",
    why: "위험 인지 후 24h 내 액션 미정의 시 모멘텀 상실 + cron이 escalate.",
    cadence: "as_needed",
    tier: "must",
    auto: { kind: "any_action_with_owner_for_critical_red" },
  },
  {
    id: "plan.l.plc_data_schema",
    team: "planning",
    phase: "launch",
    title: "PLC 운영 데이터 수집 스키마 정의",
    why: "PLC 활동 데이터 미정의면 6개월 뒤 ‘잘 운영되는지’ 판단 불가.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },

  // ── Growth ─────────────────────────────────────────────────
  {
    id: "plan.g.retention_cohort",
    team: "planning",
    phase: "growth",
    title: "1·3·6개월 잔존율(Retention Cohort) 월간 모니터",
    why: "가입자가 1·3·6개월 후 몇 %가 남는지를 매월 측정해야 PMF가 진짜인지 환상인지 구분됩니다. 3개월 잔존이 15% 밑이면 retention 평탄화 실패.",
    description:
      "ⓘ 용어 풀이\nRetention = 잔존율 = 신규 가입한 사람들이 일정 기간 후에도 활성으로 남아있는 비율.\nCohort = 같은 시기에 가입한 사용자 그룹 (예: ‘2026년 4월 가입 코호트’).\nM1·M3·M6 = 가입 후 1·3·6개월 시점의 활성 비율.\n좋은 PMF의 신호: M3 retention 곡선이 평탄화 (즉 M3=M6=M12 비슷하게 유지).\n\n⚙ 어떻게 하는가\nMixpanel·Amplitude 또는 자체 SQL로 cohort 분석 dashboard 작성. 가로축 = 가입 월, 세로축 = M0·M1·M2·M3·… 활성 비율. 세그먼트 분리: ① 전체 ② B2C 교사 개인 ③ B2B 기관. 매월 1일 회의 안건.\n\n✔ 완료 기준\n월간 자동 갱신 cohort 차트 + M3 retention < 15%면 자동 알림 + 세그먼트별 비교 리포트.",
    cadence: "monthly",
    tier: "recurring",
    domain: "A2",
    auto: { kind: "kpi_recent_within_days", metric: "retention_m3", days: 35 },
  },
  {
    id: "plan.g.pricing_review",
    team: "planning",
    phase: "growth",
    title: "가격 정책 분기 검토 — 결제 주체별 적정가 측정 (Van Westendorp 4문항)",
    why: "EdTech: 기관(원장 결정) · 교사 개인 결제 · 학부모 결제 — 세 가지 결제 주체별로 willingness-to-pay 격차가 핵심. 가격 정책을 분리해 설계해야 합니다.",
    description:
      "ⓘ 용어 풀이\nVan Westendorp = 4 질문으로 적정가를 찾는 기법.\n  ① 너무 비싸서 안 살 가격? (cheap)\n  ② 비싸지만 살까 고민할 가격? (expensive)\n  ③ 너무 싸서 품질을 의심하는 가격? (too cheap)\n  ④ 적정 가격? (acceptable)\n4 곡선의 교차점에서 ‘적정가 범위’ 도출.\n\n⚙ 어떻게 하는가\n결제 주체별 30명+ 응답 수집 (교사 자비 결제 / 원장 기관 구매 / 학부모 결제). Typeform·Tally로 4 질문 설문. 응답을 가격대별 누적 곡선으로 그려 OPP(Optimal Price Point) 찾기.\n\n✔ 완료 기준\n3 결제 주체별 적정가 그래프 + 권장 가격 범위 보고서 + 다음 분기 가격 A/B 실험 계획.",
    cadence: "quarterly",
    tier: "recurring",
    domain: "A3",
    auto: { kind: "evidence_recorded_for", code: "A3" },
  },
  {
    id: "plan.g.competitive",
    team: "planning",
    phase: "growth",
    title: "경쟁사 Win/Loss 분석 (분기) — ‘왜 우리를 골랐나/안 골랐나’",
    why: "다른 옵션(경쟁사 또는 ‘아무 것도 안 함’) 대신 우리를 고른 이유, 그리고 우리를 안 고른 이유를 분기마다 묻지 않으면 메시지·가격·세그먼트 중 결정적 결함을 못 찾습니다.",
    description:
      "ⓘ 용어 풀이\nWin/Loss 분석 = 잠재 고객이 ‘구매 결정’을 내린 후 짧은 인터뷰를 통해 우리를 고른 이유 / 안 고른 이유 / 결정적 차이 요소를 수집·분석하는 활동.\nWin-rate = 영업 기회 중 실제 계약으로 전환된 비율.\n\n⚙ 어떻게 하는가\n분기마다 win 5건 + loss 5건 인터뷰 (10–15분씩). 표준 질문: ① 어떤 대안을 고려했나 ② 결정적 요인은 무엇이었나 ③ 우리에 대해 처음 어떻게 알았나 ④ 가격 vs 기능 vs 신뢰 — 어느게 가장 중요했나. 결과를 패턴별 분류: ‘기능 부족’, ‘가격 비쌈’, ‘신뢰 부족’ 등.\n\n✔ 완료 기준\n분기 win/loss 보고서 + 발견된 패턴 3개 + 다음 분기 우선 개선 항목 1–2개 결정.",
    cadence: "quarterly",
    tier: "recurring",
    domain: "A14",
    auto: { kind: "evidence_recorded_for", code: "A14" },
  },
  {
    id: "plan.g.tradeoff_log",
    team: "planning",
    phase: "growth",
    title: "우선순위 trade-off 결정 로그 (월간)",
    why: "‘왜 X를 안 했는지’가 기록 안 되면 6개월 뒤 같은 토론 반복.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.g.feature_dead_pool",
    team: "planning",
    phase: "growth",
    title: "기능 데드 풀 분기 검토",
    why: "사용 안 되는 기능 유지 = AS 비용·인지 부하 증가. 분기마다 sunset.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.g.plc_insight_review",
    team: "planning",
    phase: "growth",
    title: "PLC 운영 인사이트 → 제품 반영 (월간)",
    why: "교사 리더가 발견한 사용 패턴은 PM 인터뷰의 5배 정보 밀도 — 놓치면 큰 손실.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },

  // ── Ops ────────────────────────────────────────────────────
  {
    id: "plan.o.roadmap_retro",
    team: "planning",
    phase: "ops",
    title: "분기 로드맵 vs 결과 회고",
    why: "계획과 실제의 격차를 정량화해야 다음 분기 계획 정확도 향상.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.o.tam_refresh",
    team: "planning",
    phase: "ops",
    title: "시장 사이즈(TAM·SAM·SOM) 반기 갱신",
    why: "한국 영유아 교사 시장은 출생률·공보육화 정책으로 매년 변동이 큽니다. 시장 사이즈를 정기적으로 재산정하지 않으면 전략·우선순위가 옛 가정에 갇힙니다.",
    description:
      "ⓘ 용어 풀이\nTAM = Total Addressable Market = 우리 카테고리의 ‘이론적 최대 시장 크기’ (전 세계 모든 가능 고객).\nSAM = Serviceable Addressable Market = 우리가 닿을 수 있는 시장 (지역·언어 한정).\nSOM = Serviceable Obtainable Market = 향후 3–5년 안에 실제로 잡을 수 있는 시장 점유.\n\n⚙ 어떻게 하는가\nTAM = (전국 유아교육기관 수 × 기관당 평균 매출) + (전국 유아교사 수 × 교사 B2C 매출). 통계청·교육부 자료 인용. SAM = 한국 + 타겟 연령대 한정. SOM = 현실적 점유율(1–3년 1–5%) 가정. 매 6개월 통계청 출생률·교사 수 갱신.\n\n✔ 완료 기준\nTAM·SAM·SOM 1장 슬라이드 + 가정·출처 명시 + 내부 전략 문서에 반영.",
    cadence: "semi_annual",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "plan.o.north_star_review",
    team: "planning",
    phase: "ops",
    title: "북극성 지표(North Star Metric) 분기 검토",
    why: "팀마다 자기 OKR을 ‘성공’이라 부르면 회사 전체가 어디로 가는지 흐려집니다. 단 하나의 ‘북극성’ 지표가 있어야 모든 팀이 같은 방향을 봅니다.",
    description:
      "ⓘ 용어 풀이\nNorth Star Metric = 회사가 ‘우리는 이 숫자가 올라가는 게 곧 사용자 가치가 늘어나는 거다’라고 합의한 단 하나의 지표. 예: Airbnb = ‘예약된 숙박 일수’, Spotify = ‘월간 청취 시간’, Slack = ‘팀당 주간 메시지 수’.\n\n⚙ 어떻게 하는가\n분기 전사 회의에서 ‘우리 NSM은 뭐냐’를 질문. 좋은 NSM 3 조건: ① 사용자 가치를 직접 반영 ② 단일 숫자로 측정 ③ 매출과 양의 상관. 후보 3개 → 토론 → 1개로 확정. 부정 가지 지표 (counter-metric)도 함께 정의해 ‘NSM만 추구해 왜곡되는 것’ 방지.\n\n✔ 완료 기준\n전 직원이 ‘NSM이 뭐냐’ 질문에 같은 답을 함. NSM이 모든 팀 OKR 첫째 줄에 등장. 매주 자동 측정·공유.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },

  // ════════════════════════════════════════════════════════════
  //  디자인팀 / DESIGN
  // ════════════════════════════════════════════════════════════
  // ── Foundation ─────────────────────────────────────────────
  {
    id: "design.f.system",
    team: "design",
    phase: "foundation",
    title: "디자인 시스템 (토큰 + 컴포넌트 라이브러리) 확립",
    why: "팀 규모가 커질수록 같은 버튼·색·간격을 매번 다시 그리면 화면 일관성이 붕괴됩니다. 디자인 ‘기본 부품’을 정의해야 디자이너·개발자 모두 같은 언어로 일합니다.",
    description:
      "ⓘ 용어 풀이\n디자인 토큰 = 색상·간격·글꼴 크기 등 ‘디자인의 기본 변수’를 코드와 디자인 도구가 공유하는 변수 시스템 (예: --color-accent, --space-4).\n컴포넌트 라이브러리 = 자주 쓰는 UI 부품(버튼·input·카드·모달)의 표준 구현. 한 번 만들면 어디서나 재사용.\n\n⚙ 어떻게 하는가\n도구: Figma + Storybook(or Chromatic) + Tailwind/CSS-in-JS 토큰. 1단계: 색상·간격·글꼴 토큰 30–50개 정의. 2단계: 핵심 컴포넌트 10–15개(button/input/card/modal/select/checkbox/tag/avatar/tooltip 등) 구현. 각 컴포넌트는 Storybook에 문서화 + 사용 예시.\n\n✔ 완료 기준\n신규 화면 디자인 시 80% 이상 기존 컴포넌트로 조립되고, 새 색상·간격을 ‘하드코딩’ 없이 토큰만 사용 가능한 상태.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.f.a11y",
    team: "design",
    phase: "foundation",
    title: "접근성(WCAG AA) 기준 체크리스트",
    why: "한국 EdTech에서 시각·청각 보조 도구 사용자(학부모·교사 모두)를 배제하면 평가제 감점 + 민원 + 법적 책임 동시 노출.",
    description:
      "ⓘ 용어 풀이\nWCAG = Web Content Accessibility Guidelines. W3C가 정한 웹 접근성 표준.\nAA = 권장 준수 레벨 (A는 최소, AAA는 엄격). 대부분의 기업은 AA를 목표로 함.\n주요 기준: ① 색 대비 4.5:1 이상 ② 모든 이미지 alt 텍스트 ③ 키보드만으로 모든 기능 사용 가능 ④ 스크린리더 호환 ⑤ 폼 라벨 명시.\n\n⚙ 어떻게 하는가\n도구: axe DevTools(Chrome 확장)·Lighthouse·WAVE로 자동 검사. 핵심 페이지 5–10개를 점검해 AA 위반 항목 목록화. 우선 수정: 색 대비 + 키보드 포커스 표시 + alt 텍스트. CI 파이프라인에 axe 자동 검사 추가.\n\n✔ 완료 기준\nLighthouse 접근성 점수 90+ + axe DevTools 위반 0건 + 키보드만으로 핵심 흐름(가입·진단·결제) 100% 사용 가능.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.f.activation_setup",
    team: "design",
    phase: "foundation",
    title: "신규 가입자 첫 1일·7일 활성화 비율 측정 셋업",
    why: "가입 후 1일 안에 우리 서비스에서 ‘첫 가치’를 경험한 비율(D1 activation)이 20% 미만이면 온보딩이 망가진 것입니다. 가장 빨리 잡히는 위험 신호.",
    description:
      "GA4·Mixpanel·Amplitude 중 하나로 다음 이벤트를 트래킹: ‘가입 완료’, ‘첫 핵심 행동(예: 첫 진단 응답)’, ‘재방문(D7)’. 그 다음 funnel 리포트를 만들어 가입 → 첫 핵심 행동 → 7일 후 재방문 비율을 산출. ‘완료’ 기준: 매일 자동 갱신되는 D1·D7 활성화 비율 대시보드 + Slack 일일 알림.",
    cadence: "once",
    tier: "must",
    domain: "A4",
    auto: { kind: "evidence_recorded_for", code: "A4" },
  },
  {
    id: "design.f.empty_states",
    team: "design",
    phase: "foundation",
    title: "Empty state UX 디자인 라이브러리",
    why: "데이터 없는 첫 화면에서 사용자가 ‘뭘 해야 하지?’를 안 만들게.",
    cadence: "once",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.f.plc_pages",
    team: "design",
    phase: "foundation",
    title: "PLC 그룹 페이지 + 교사 리더 대시보드 디자인",
    why: "리더용·멤버용 화면이 분리 안 된 채 운영 시작 시 관리 비용 매주 증가.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.f.teacher_personal_account",
    team: "design",
    phase: "foundation",
    title: "교사 개인 계정 페이지 — 본인 성장 대시보드 설계",
    why: "기관 가입 화면과 교사 개인 가입은 의사결정 기준·노출 정보가 다릅니다. 교사 개인은 ‘내 학급에 어떻게 도움되나 / 내 성장 기록이 어떻게 쌓이나’를 30초 안에 봐야 합니다.",
    description:
      "교사 개인 페이지에 들어가야 할 4 모듈: ① 학급 운영 효율 지표(시간 절감 리포트) ② 본인 진단·성장 기록(누리과정 영역별) ③ 동료 교사들의 성공 사례 카드 ④ 다음 주 추천 활동/콘텐츠. 기관 화면과 별개의 사이드바·네비게이션. ‘완료’ 기준: 교사 개인 사용자가 가입 → 첫 가치 경험까지 5분 이내 도달하는 화면 흐름 라이브.",
    cadence: "once",
    tier: "must",
    domain: "A4",
    auto: { kind: "manual_only" },
    boost_domains: ["A4", "A2"],
  },

  // ── Launch ─────────────────────────────────────────────────
  {
    id: "design.l.onboarding_ab",
    team: "design",
    phase: "launch",
    title: "Onboarding A/B 테스트 (D1 < 20% 시)",
    why: "Aha moment 도달률을 의도적으로 끌어올리지 않으면 retention은 자연 감소.",
    cadence: "as_needed",
    tier: "conditional",
    domain: "A4",
    auto: { kind: "coach_session_resolved_for", code: "A4" },
  },
  {
    id: "design.l.icp_onboarding",
    team: "design",
    phase: "launch",
    title: "핵심 세그먼트 전용 onboarding",
    why: "한 onboarding으로 모든 세그먼트를 만족시키면 어느 곳도 잘 못 함.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.l.ttv_short",
    team: "design",
    phase: "launch",
    title: "신규 가입자가 ‘첫 가치’ 경험까지 걸리는 시간 측정·단축",
    why: "신규 가입자가 5분 안에 우리 서비스에서 ‘좋다’를 느끼지 못하면 그 날 70%가 다시 안 옵니다. 첫 가치 경험까지의 시간(Time-to-Value)을 짧게 만드는 것이 retention의 핵심.",
    description:
      "‘첫 가치’를 정의: 우리 서비스에서 사용자가 ‘이거 쓸만하네’를 느끼는 가장 빠른 순간 (예: 첫 진단 결과 페이지 도달, 첫 워크리스트 클릭). 가입 → 첫 가치까지의 평균 시간(분)을 측정. 매월 1회 가입자 5명 직접 관찰하거나 세션 리플레이 (Hotjar/Microsoft Clarity)로 막히는 구간 찾기. 단축 실험 (A/B 테스트)으로 매월 1분씩 줄이는 게 목표.",
    cadence: "monthly",
    tier: "recurring",
    domain: "A4",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.l.trust_review",
    team: "design",
    phase: "launch",
    title: "신뢰·안전 페이지 visual review",
    why: "EdTech는 학부모 신뢰가 LTV의 80% — 실수 1번이 수개월 영업 무력화.",
    cadence: "quarterly",
    tier: "recurring",
    domain: "A7",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.l.plc_activity_view",
    team: "design",
    phase: "launch",
    title: "PLC 활동 가시화 — 멤버용 화면",
    why: "내가 속한 그룹의 진행 상황·다른 멤버 활동 보이지 않으면 1주차에 이탈.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },

  // ── Growth ─────────────────────────────────────────────────
  {
    id: "design.g.nps_inapp",
    team: "design",
    phase: "growth",
    title: "NPS(추천 의향) 설문 앱 안에서 분기 1회 노출",
    why: "NPS는 ‘이 서비스를 친구에게 추천할 가능성’ 점수입니다. 마이너스로 떨어지면 입소문이 negative — 마케팅 예산을 아무리 써도 새는 양동이.",
    description:
      "ⓘ 용어 풀이\nNPS = Net Promoter Score. 0–10점 ‘얼마나 추천할까요?’ 단일 질문. 9–10 = Promoter, 7–8 = Passive, 0–6 = Detractor. NPS = Promoter% − Detractor%. -100 ~ +100.\n\n⚙ 어떻게 하는가\n분기마다 활성 사용자 100명+에게 인앱 모달로 단일 질문. ‘0–10 중 친구·동료에게 우리를 추천할 가능성?’ + 후속 질문 ‘이 점수를 매긴 이유는?’. 응답 자동 수집 → Promoter%·Detractor% 계산.\n\n✔ 완료 기준\n분기 1회 자동 노출 + 응답 100건+ 수집 + NPS 점수 + 자유 답변(reason) 카테고리 분류 → 전사 공유.",
    cadence: "quarterly",
    tier: "recurring",
    domain: "A13",
    auto: { kind: "evidence_recorded_for", code: "A13" },
  },
  {
    id: "design.g.heatmap_review",
    team: "design",
    phase: "growth",
    title: "Heatmap·세션 리플레이 월간 리뷰 (사용자가 어디서 막히는지)",
    why: "지표 숫자만 보면 ‘왜 이탈하는지’를 모릅니다. 사용자의 마우스 움직임·클릭·스크롤을 영상으로 보면 막히는 구간이 직접 보입니다.",
    description:
      "ⓘ 용어 풀이\nHeatmap(열지도) = 페이지에서 사용자들이 어디를 자주 클릭·hover·스크롤하는지를 빨강~파랑 색상으로 표시한 그림.\n세션 리플레이 = 사용자 한 명이 우리 서비스를 쓰는 모습을 영상처럼 재생해 보는 도구.\n둘 다 PII 자동 마스킹 (입력 필드 가림).\n\n⚙ 어떻게 하는가\n도구 선택: Hotjar·Microsoft Clarity(무료)·FullStory. 핵심 페이지 3–5개에 추적 코드 추가. 매월 첫째 주에 ‘이탈자 세션 10개·전환자 세션 10개’를 비교 시청. 이탈자 공통 막힌 구간을 찾아 디자인 수정 백로그로 등록.\n\n✔ 완료 기준\n월간 리뷰 회의에서 ‘이번 달 막힌 구간 3개 + 다음 달 개선 액션’ 정리한 노트가 팀에 공유되면 완료.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.g.teacher_share_page",
    team: "design",
    phase: "growth",
    title: "교사가 학부모에게 공유할 수 있는 정보 페이지",
    why: "교사가 자녀 발달·일과·관찰 기록을 학부모에게 공유할 때 통제권은 교사에게 있어야 합니다. 무엇을·얼마나·어떻게 공개할지 교사가 한 화면에서 직접 선택할 수 있어야 사용 부담이 줄어듭니다.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.g.privacy_readability",
    team: "design",
    phase: "growth",
    title: "개인정보·이용약관 가독성 점검",
    why: "PIPA·아동개인정보 — 약관 가독성 낮으면 동의 무효화 리스크.",
    cadence: "semi_annual",
    tier: "must",
    domain: "A7",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.g.paid_upgrade_ux",
    team: "design",
    phase: "growth",
    title: "유료 업그레이드 화면 A/B 테스트 (분기)",
    why: "전환 화면 1pt 차이가 paid 가입자 수에 직격 — 가장 ROI 높은 UX 레버.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    escalation_hint: "유료 가입자 목표 200명+ 시 월간으로 가속",
  },

  // ── Ops ────────────────────────────────────────────────────
  {
    id: "design.o.cs_pattern",
    team: "design",
    phase: "ops",
    title: "CS 티켓 패턴 → UX 우선순위 (월간)",
    why: "사용자가 같은 곳에서 막히면 UX 결함이 매주 CS 비용으로 청구됨.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.o.power_user_loop",
    team: "design",
    phase: "ops",
    title: "Power user feedback loop 운영",
    why: "Top 10% 사용자의 행동은 다음 분기 PMF 신호의 가장 강한 leading indicator.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.o.responsive_audit",
    team: "design",
    phase: "ops",
    title: "모바일/태블릿 반응형 점검 (분기)",
    why: "한국 EdTech: 학부모 70%+가 모바일 — 데스크톱 only 디자인은 매출 절반 포기.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "design.o.ab_report",
    team: "design",
    phase: "ops",
    title: "A/B 테스트 결과 일관 보고 (월간)",
    why: "테스트 결과 공유 안 하면 다른 팀이 같은 실험 반복 — 자원 낭비.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },

  // ════════════════════════════════════════════════════════════
  //  개발팀 / ENGINEERING
  // ════════════════════════════════════════════════════════════
  // ── Foundation ─────────────────────────────────────────────
  {
    id: "eng.f.cicd",
    team: "engineering",
    phase: "foundation",
    title: "자동 배포 파이프라인(CI/CD) 셋업",
    why: "수동 배포는 분기당 사고 1회 보장. 자동화 없이는 ‘빠르게’와 ‘안정적으로’를 동시에 못 합니다.",
    description:
      "ⓘ 용어 풀이\nCI(Continuous Integration) = 코드 변경마다 자동으로 빌드·테스트 → 통과해야 main 브랜치 머지.\nCD(Continuous Deployment) = main 브랜치에 머지되면 자동으로 운영 환경 배포.\n둘을 합쳐 CI/CD = 사람이 ‘배포 버튼’을 안 누르고도 안전하게 배포되는 자동화 파이프라인.\n\n⚙ 어떻게 하는가\nGitHub Actions·Vercel·CircleCI 중 선택. 워크플로 3단계: ① PR 생성 시 lint+test 자동 실행 ② main 머지 시 staging 자동 배포 ③ tag push 시 production 자동 배포. 실패 시 Slack 알림.\n\n✔ 완료 기준\nlocal에서 git push만 하면 5분 안에 staging이 자동 배포되고, production 배포가 1-click 또는 자동인 상태.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.f.test_coverage",
    team: "engineering",
    phase: "foundation",
    title: "자동 테스트 커버리지 70% 이상 유지",
    why: "코드 변경할 때마다 ‘이게 다른 데를 깨뜨리진 않나?’를 사람이 일일이 확인하면 늦거나 놓칩니다. 자동 테스트가 70% 이상 커버하지 않으면 회귀 사고가 4배 자주 발생합니다.",
    description:
      "ⓘ 용어 풀이\n테스트 커버리지 = 전체 코드 줄 중 자동 테스트가 ‘실행해본’ 줄의 비율 (%).\n회귀(regression) = 새 코드 추가가 기존 기능을 망가뜨리는 현상.\n단위 테스트 = 함수 한 개 검증. 통합 테스트 = 여러 부품 함께 검증. E2E = 사용자 흐름 전체 검증.\n\n⚙ 어떻게 하는가\n도구: Vitest·Jest(단위)·Playwright(E2E). 70% 목표는 ‘100% 커버해라’가 아니라 ‘핵심 비즈니스 로직과 위험 경로를 우선 커버해라’. CI에 커버리지 측정 + PR이 커버리지를 하향시키면 머지 차단. 매월 커버리지 리포트 공유.\n\n✔ 완료 기준\nCI에서 커버리지 자동 측정 + 70% 미만 PR 머지 차단 + 월간 커버리지 시계열을 팀에 공유.",
    cadence: "monthly",
    tier: "must",
    domain: "A8",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.f.rls_setup",
    team: "engineering",
    phase: "foundation",
    title: "DB 접근 권한 정책(RLS) 셋업 + 분기 검증",
    why: "워크스페이스 A의 사용자가 워크스페이스 B 데이터를 볼 수 있으면 — EdTech에선 회사 종료 사유 (PIPA·KISA 위반).",
    description:
      "ⓘ 용어 풀이\nRLS = Row-Level Security. ‘이 사용자가 이 행(row)을 읽을 수 있는가’를 DB 자체가 판정하게 하는 정책. 애플리케이션 코드의 버그가 있어도 DB가 막아주는 안전망.\n\n⚙ 어떻게 하는가\nSupabase·Postgres에서 각 테이블마다 ‘USING’ 절로 정책 작성. 예: `org_id = current_org_id()`. ‘service_role’ 키는 RLS 우회 — 서버 사이드 코드에서만 사용. 분기마다 ‘다른 워크스페이스 ID로 위장 후 쿼리 시도 → 0 row 반환되는지’ 회귀 테스트.\n\n✔ 완료 기준\n전 테이블에 RLS 활성화 + 정책 작성 + 자동 회귀 테스트 통과 + 분기 1회 수동 침투 테스트.",
    cadence: "quarterly",
    tier: "must",
    domain: "A7",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.f.privacy_consent",
    team: "engineering",
    phase: "foundation",
    title: "개인정보 수집 동의 흐름 검증 (만 14세 미만 법정대리인 포함)",
    why: "한국 개인정보보호법은 만 14세 미만 아동의 개인정보를 수집할 때 법정대리인(부모) 동의를 별도로 받게 합니다. 이걸 빠뜨린 EdTech는 영업정지 1순위.",
    description:
      "ⓘ 용어 풀이\nPIPA = 개인정보보호법 (Personal Information Protection Act). 한국의 개인정보 핵심 법률.\n법정대리인 = 만 14세 미만 아동의 부모/보호자. 아동 본인 동의로는 부족, 별도 동의 필요.\n수집 동의 = 어떤 정보를 / 어떤 목적으로 / 얼마나 보관하나 — 3가지를 명시한 후 ‘동의’ 받는 절차.\n\n⚙ 어떻게 하는가\n흐름 점검: ① 가입 시 ‘서비스 이용자가 만 14세 미만인가요?’ 체크 ② 그렇다면 부모 이메일·이름·관계 입력 ③ 부모에게 인증 메일 → 클릭하면 동의 완료 ④ 동의 기록(시점·IP·내용) DB 보관 ⑤ 철회 권리 안내. 변호사 또는 KISA 가이드 참조.\n\n✔ 완료 기준\n동의 흐름 라이브 + 동의 기록 감사 가능 + 만 14세 미만 사용자에 대해 부모 동의 없이는 데이터 수집 안 되는 게이트 작동.",
    cadence: "once",
    tier: "must",
    domain: "A7",
    auto: { kind: "manual_only" },
  },

  // ── Launch ─────────────────────────────────────────────────
  {
    id: "eng.l.kpi_stripe",
    team: "engineering",
    phase: "launch",
    title: "결제 시스템(Stripe·Toss) webhook 연동",
    why: "결제 데이터를 수동으로 정리하면 분기마다 한 번 본다는 뜻 — 그 동안 새는 매출은 못 잡습니다. webhook 자동 연동이 매출·CAC payback 자동 측정의 출발점.",
    description:
      "ⓘ 용어 풀이\nWebhook = 결제 이벤트(가입·결제·환불·해지)가 발생할 때 결제사가 우리 서버에 자동으로 HTTP POST 알림을 보내는 구조.\nStripe = 글로벌 결제 (USD·KRW 모두 처리)\nToss Payments = 한국 결제 (간편결제·계좌이체)\n\n⚙ 어떻게 하는가\n결제사 대시보드에서 webhook URL 등록 (예: `/api/webhooks/stripe`). 처리해야 할 이벤트: ① `payment_intent.succeeded` ② `customer.subscription.created` ③ `customer.subscription.deleted` ④ `invoice.payment_failed`. 각 이벤트마다 우리 DB의 `kpi_snapshots`에 자동 기록.\n\n✔ 완료 기준\n실제 결제 1건이 발생했을 때 5분 안에 우리 대시보드에 자동 반영. 환불·해지도 같이 추적.",
    cadence: "once",
    tier: "must",
    domain: "A5",
    auto: { kind: "kpi_source_connected", source: "stripe" },
  },
  {
    id: "eng.l.kpi_ga4",
    team: "engineering",
    phase: "launch",
    title: "Google Analytics 4(GA4) 트래픽·전환 측정 연동",
    why: "어떤 광고·콘텐츠가 사용자를 데려오고 어떤 페이지에서 이탈하는지를 측정 안 하면, 마케팅은 ‘느낌’으로 예산을 씁니다.",
    description:
      "ⓘ 용어 풀이\nGA4 = Google Analytics 4. Google의 무료 웹·앱 분석 도구. 이전 버전(Universal Analytics)을 대체.\nGA4 핵심 메트릭: ① 사용자(users) ② 세션 ③ 이벤트(예: signup, paid_upgrade) ④ 전환(conversion) — 우리가 ‘목표’로 등록한 이벤트.\n\n⚙ 어떻게 하는가\nGA4 속성 생성 → 측정 ID(G-XXXXXXX) 받기 → 사이트에 GA4 태그 삽입 (gtag.js 또는 Google Tag Manager). 핵심 이벤트 등록: signup_complete, first_diagnosis, paid_upgrade. UTM 파라미터로 채널 구분 (utm_source, utm_medium, utm_campaign).\n\n✔ 완료 기준\nGA4 대시보드에서 ‘채널별 신규 사용자 → 전환율’ 깔때기가 자동 갱신되고, 매주 마케팅 회의에서 인용되는 상태.",
    cadence: "once",
    tier: "must",
    auto: { kind: "kpi_source_connected", source: "ga4" },
  },
  {
    id: "eng.l.kpi_mixpanel",
    team: "engineering",
    phase: "launch",
    title: "사용자 행동 분석 도구(Mixpanel·Amplitude) 이벤트 셋업",
    why: "사용자가 우리 서비스 안에서 어떤 행동을 하는지 추적 안 하면 retention·funnel 분석이 모두 추측이 됩니다.",
    description:
      "ⓘ 용어 풀이\nMixpanel·Amplitude = 사용자의 모든 행동(이벤트)을 추적·분석하는 SaaS 도구. GA4와 다른 점: GA4는 페이지뷰 중심, Mixpanel은 ‘이벤트 + 사용자 ID’ 중심이라 cohort·funnel 분석이 강함.\n이벤트 스키마 = ‘어떤 행동을 추적할지’를 미리 정해둔 카탈로그 (예: signup, first_diagnosis, paid_upgrade).\n\n⚙ 어떻게 하는가\n핵심 이벤트 10–15개를 먼저 정의 (욕심 부리면 데이터 카오스). 각 이벤트에 표준 속성(user_id·timestamp·domain·plan) 일관 부착. 클라이언트 SDK 설치 → 이벤트 firing 코드 → 대시보드에서 funnel 1개 만들어 검증.\n\n✔ 완료 기준\n핵심 funnel 1개 (예: signup → first_diagnosis → paid) 가 대시보드에 자동 갱신되고, 코호트 분석이 가능한 상태.",
    cadence: "once",
    tier: "must",
    auto: { kind: "kpi_source_connected", source: "mixpanel" },
  },
  {
    id: "eng.l.pii_redaction_test",
    team: "engineering",
    phase: "launch",
    title: "PII(개인 식별 정보) 자동 마스킹 단위 테스트 통과",
    why: "외부 AI(Claude·OpenAI 등)에 사용자 개인정보를 그대로 보내면 즉시 사고. 마스킹 로직이 모든 PII 패턴(이름·이메일·전화·주민번호)을 잡는지 자동 테스트로 보장해야 합니다.",
    description:
      "ⓘ 용어 풀이\nPII = Personally Identifiable Information = 개인 식별 정보. 한국에서는 이름·이메일·전화·주민번호·계좌번호 등.\nRedaction = 정보를 [REDACTED]·****·★★ 같은 토큰으로 가리는 처리.\n\n⚙ 어떻게 하는가\n정규식 기반 redaction 함수 작성: ① 한국 이름(2–4자 한글) ② 이메일 ③ 전화(010-XXXX-XXXX) ④ 주민번호(YYMMDD-XXXXXXX) ⑤ 카드번호 ⑥ 영문 이름. 단위 테스트 100+ 케이스 (다양한 텍스트에 PII 섞어 입력 → 모두 마스킹 됐는지 검증). CI에 통합.\n\n✔ 완료 기준\nPR마다 PII 마스킹 테스트 100% 통과 + 외부 AI 호출 wrapper에서 자동 호출 + 월간 ‘새 PII 패턴 발견’ 룩백 회의.",
    cadence: "monthly",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.l.plc_group_feature",
    team: "engineering",
    phase: "launch",
    title: "PLC 그룹 기능 + 교사 리더 권한 모델 개발",
    why: "그룹·역할·초대·콘텐츠 공유 — 4개 중 하나라도 빠지면 PLC 운영 불가.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },

  // ── Growth ─────────────────────────────────────────────────
  {
    id: "eng.g.eval_pipeline",
    team: "engineering",
    phase: "growth",
    title: "AI 응답 자동 평가(Eval) 파이프라인 구축",
    why: "LLM은 같은 prompt도 매번 다르게 답합니다. 사람이 일일이 읽어 ‘좋아졌는지’ 판정하면 늦거나 놓침 — 자동 평가 없이는 환각 출시.",
    description:
      "ⓘ 용어 풀이\nLLM = Large Language Model (Claude·GPT 등 대형 언어 모델).\nEval = 모델 출력을 ‘맞다·틀리다·점수’로 자동 평가하는 테스트 셋.\n환각 = LLM이 사실이 아닌 정보를 자신있게 답하는 현상.\n회귀 = 새 prompt·모델로 바꾼 후 이전보다 나빠지는 현상.\n\n⚙ 어떻게 하는가\n‘질문 + 기대 답변 키워드/패턴’ 100–500쌍 만들기. 각 prompt 변경마다 100쌍 모두 자동 실행 → 통과율·정확도·환각률 측정. Promptfoo·Braintrust·자체 스크립트 중 선택. CI에 연결해 PR마다 자동 실행.\n\n✔ 완료 기준\nPR 머지 전 eval이 자동 실행되고, 통과율이 baseline 95% 이상이어야 머지 가능한 게이트가 작동.",
    cadence: "quarterly",
    tier: "must",
    domain: "A9",
    auto: { kind: "evidence_recorded_for", code: "A9" },
  },
  {
    id: "eng.g.rag_refresh",
    team: "engineering",
    phase: "growth",
    title: "AI 코치의 참고자료(RAG 인덱스) 분기 갱신",
    why: "AI 코치가 ‘작년 누리과정 기준’을 자신있게 인용하면 사용자 신뢰가 무너집니다. 참고자료를 분기마다 새로 색인해야 합니다.",
    description:
      "ⓘ 용어 풀이\nRAG = Retrieval-Augmented Generation. AI가 답하기 전에 미리 인덱싱한 참고문서에서 관련 부분을 검색(retrieve) → 그 내용을 근거로 답하게 하는 패턴. 환각 줄이고 출처 추적 가능.\n인덱스 = 참고문서를 임베딩(벡터)으로 변환해 저장한 검색 가능한 DB.\n\n⚙ 어떻게 하는가\nRAG 소스 카탈로그 (누리과정·KISA·CB Insights·Bessemer·OpenView 등)에서 분기마다 새로 발행된 자료를 다운로드. 텍스트 추출 → 청크 분할 → 임베딩(OpenAI·Voyage·BGE 등) → pgvector·Pinecone 같은 벡터 DB에 저장. 변경 사항을 changelog로 남김.\n\n✔ 완료 기준\n분기 새 자료가 인덱스에 반영되고, AI 코치 답변에 ‘출처: [문서명, 발행일]’이 표시되며, eval 테스트 통과율 유지.",
    cadence: "quarterly",
    tier: "recurring",
    domain: "A9",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.g.dora",
    team: "engineering",
    phase: "growth",
    title: "개발팀 속도 지표 측정 (배포 빈도·리드 타임)",
    why: "‘바쁘다’와 ‘실제로 빠르다’는 다릅니다. 배포 주기·코드 → 운영 반영까지의 시간을 매월 측정하지 않으면, 야근만 늘고 출시 속도는 그대로일 수 있습니다.",
    description:
      "Google DORA 4지표: ① Deploy frequency (월 배포 횟수) ② Lead time for changes (PR 머지 → 운영 배포까지) ③ Mean time to restore (incident 발생 → 복구까지) ④ Change failure rate (배포 후 hotfix 비율). GitHub Actions·Linear·Sentry에서 데이터 수집. 매월 1일에 4개 수치를 시트에 기록하고 Engineering 회의에서 공유. ‘완료’ 기준: 자동 수집 파이프라인 + 월간 리포트 정기 공유.",
    cadence: "monthly",
    tier: "recurring",
    domain: "A8",
    auto: { kind: "evidence_recorded_for", code: "A8" },
  },
  {
    id: "eng.g.prompt_versioning",
    team: "engineering",
    phase: "growth",
    title: "Prompt versioning + 회귀 테스트",
    why: "프롬프트 변경의 영향을 측정하지 않으면 ‘좋아진 줄 알았는데 더 나빠짐’ 빈발.",
    cadence: "monthly",
    tier: "recurring",
    domain: "A9",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.g.plc_kpi_pipeline",
    team: "engineering",
    phase: "growth",
    title: "PLC 활동 KPI 파이프라인 (참여·콘텐츠·활성)",
    why: "PLC가 ‘잘 운영되는지’를 데이터로 못 보면 운영팀이 매주 손으로 정리.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },

  // ── Ops ────────────────────────────────────────────────────
  {
    id: "eng.o.kisa_self_audit",
    team: "engineering",
    phase: "ops",
    title: "KISA(한국 인터넷 진흥원) ISMS-P 보안 자기점검 (반기)",
    why: "한국 EdTech가 영업정지 당하는 가장 흔한 사유 = 보안·개인정보보호 위반. 인증 받기 전에도 자기점검은 의무에 가까운 안전망.",
    description:
      "ⓘ 용어 풀이\nKISA = 한국 인터넷 진흥원. 국내 정보보호 인증 운영 기관.\nISMS-P = ‘정보보호 및 개인정보보호 관리체계’ — 102개 통제항목으로 구성된 한국 표준 보안 체크리스트. 학원·EdTech·핀테크 등은 일정 매출 이상이면 의무 인증.\n\n⚙ 어떻게 하는가\nKISA 공식 ISMS-P 가이드라인 다운로드 → 102개 항목 체크리스트 작성 → 항목별 ‘준수 / 미준수 / 부분 준수 / 해당 없음’ 판정 → 미준수 항목은 액션 플랜과 담당자 지정. 6개월마다 재검토.\n\n✔ 완료 기준\n102개 항목 모두 판정 완료된 자기점검 보고서 + 미준수 항목별 액션 플랜 + 다음 분기 점검 일정 등록.",
    cadence: "semi_annual",
    tier: "must",
    domain: "A7",
    auto: { kind: "evidence_recorded_for", code: "A7" },
  },
  {
    id: "eng.o.security_drill",
    team: "engineering",
    phase: "ops",
    title: "보안 incident 대응 매뉴얼 + 모의 훈련 (반기)",
    why: "incident가 처음 발생할 때 매뉴얼 없으면 응대 시간이 24시간 → 72시간으로.",
    cadence: "semi_annual",
    tier: "must",
    domain: "A7",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.o.handoff_monitor",
    team: "engineering",
    phase: "ops",
    title: "외부 AI 핸드오프 webhook 콜백 모니터",
    why: "30분 timeout 회수 cron이 멈추면 외부 비용·답변이 leak.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.o.slo_alerts",
    team: "engineering",
    phase: "ops",
    title: "서비스 안정성 목표(SLO·SLA) 모니터링 + 자동 알림",
    why: "사용자가 ‘느려요’라고 신고하기 전에 우리가 먼저 알아야 합니다. alert 없으면 첫 발견이 24시간 늦어 신뢰가 영구 훼손.",
    description:
      "ⓘ 용어 풀이\nSLO = Service Level Objective. ‘95% 요청을 1초 안에 응답한다’ 같은 내부 목표.\nSLA = Service Level Agreement. 고객·계약 대상으로 약속한 외부 기준 (위반 시 환불 등).\n에러 버짓 = 한 달 동안 SLO를 위반해도 되는 한도. 다 쓰면 신규 출시 freeze.\n\n⚙ 어떻게 하는가\n핵심 메트릭 4개 정의: ① 응답 속도(p95 latency) ② 가용성(uptime%) ③ 에러율 ④ 데이터 정확성. 각각 목표값 설정. Sentry·Datadog·UptimeRobot 등에서 alerting 룰 작성. SLO 위반 시 PagerDuty·Slack 알림.\n\n✔ 완료 기준\n4 메트릭 모두 자동 측정 + 위반 시 알림이 5분 안에 도착 + 월간 에러 버짓 사용률을 보드에 노출.",
    cadence: "weekly",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "eng.o.dr_check",
    team: "engineering",
    phase: "ops",
    title: "DB 백업·재해 복구(DR) 분기 실제 복구 테스트",
    why: "‘백업이 있다’와 ‘진짜 복구된다’는 다른 문제입니다. 사고 터지고 복구 시도해서야 깨달으면 늦음 — 분기마다 실제로 복구를 돌려봐야 합니다.",
    description:
      "ⓘ 용어 풀이\nDR = Disaster Recovery = 재해(서버·DB 장애·해킹 등) 발생 시 서비스 복구 절차.\nRTO = Recovery Time Objective = 복구까지 허용되는 최대 시간 (예: 4시간).\nRPO = Recovery Point Objective = 잃어도 되는 최대 데이터 시간 (예: 15분 — 즉 백업 빈도).\n\n⚙ 어떻게 하는가\n분기마다 staging에 ‘어제 백업본’으로 DB 전체 복구 → 핵심 데이터 정합성 자동 검증 스크립트 실행 → 결과를 DR 보고서에 기록. 백업 자체는 PITR(Point-in-Time Recovery)을 보장하는 자동 백업 (Supabase·RDS 기본 제공).\n\n✔ 완료 기준\n분기 1회 staging DR 테스트 통과 + RTO/RPO 명시된 DR 플레이북 + 위반 시 운영팀·대표 알림.",
    cadence: "quarterly",
    tier: "must",
    domain: "A7",
    auto: { kind: "manual_only" },
  },

  // ════════════════════════════════════════════════════════════
  //  운영팀 / OPERATIONS
  // ════════════════════════════════════════════════════════════
  // ── Foundation ─────────────────────────────────────────────
  {
    id: "ops.f.runbook",
    team: "operations",
    phase: "foundation",
    title: "운영 매뉴얼(Runbook) 문서화 — CS·사고 대응·정기 작업",
    why: "‘이거 어떻게 하지?’를 매번 한 사람한테 물어봐야 한다면, 그 사람이 휴가가는 순간 회사가 멈춥니다. 절차를 누구나 따라할 수 있게 글로 남겨야 합니다.",
    description:
      "ⓘ 용어 풀이\nRunbook = ‘이런 상황에선 이렇게 한다’를 단계별로 적은 운영 매뉴얼. 사고 대응·정기 작업·신규 입사자 온보딩 등에 사용. 코드보다 ‘사람용 코드’.\n\n⚙ 어떻게 하는가\n분류: ① CS 응대 (P0/P1/P2 분류, 응답 시간, 에스컬레이션) ② 사고 대응 (장애·보안·결제 실패) ③ 정기 작업 (주간 디지스트·월말 마감·분기 보고) ④ 신규 입사자 첫 30일. 각 항목을 ‘트리거 → 1단계 → 2단계 → 검증 → 누구에게 보고’ 형식으로 1–2장 정리. Notion·Confluence·GitHub Wiki 중 선택.\n\n✔ 완료 기준\n10–20개 핵심 runbook + 신규 입사자가 첫 주에 매뉴얼만으로 P2 CS 1건 처리 가능 + 분기 1회 update 회고.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "ops.f.help_center",
    team: "operations",
    phase: "foundation",
    title: "Help Center 초기 50개 문서 셋업",
    why: "매뉴얼 없이는 모든 질문이 CS 1:1 → 인력 비용 폭증.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "ops.f.teacher_leader_recruit",
    team: "operations",
    phase: "foundation",
    title: "교사 리더 모집·인터뷰 프로토콜 (Q1)",
    why: "PLC 성공의 90%가 리더 1인 — 채용·검증 절차 없으면 품질 붕괴.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
    escalation_hint: "PLC 목표 30개+ 시 분기 모집 사이클 운영 권장",
  },

  // ── Launch ─────────────────────────────────────────────────
  {
    id: "ops.l.action_owner_24h",
    team: "operations",
    phase: "launch",
    title: "액션 담당자·기한 등록 (코치 채택 후 24h)",
    why: "Owner 미지정 액션은 ‘아무도 안 함’으로 수렴.",
    cadence: "as_needed",
    tier: "must",
    auto: { kind: "all_red_critical_have_action" },
  },
  {
    id: "ops.l.first30_call",
    team: "operations",
    phase: "launch",
    title: "신규 교사 첫 30일 온보딩 콜 (high-value 사용자)",
    why: "교사 가입 30일이 계속 사용 결정의 80% — 무콜 사용자는 이탈 3배. 1:1 콜에서 교사가 첫 효과(예: 알림장 작성 시간 50% 단축)를 명시적으로 확인받아야 다음 학기에도 계속 씁니다.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    escalation_hint: "월 신규 교사 200명+ 시 high-value 사용자 우선으로 자동화",
    stage_relevance: ["open_beta", "ga_early", "ga_growth"],
  },
  {
    id: "ops.l.teacher_b2c_onboarding",
    team: "operations",
    phase: "launch",
    title: "교사 개인 가입자 B2C 온보딩 자동화 (이메일·인앱)",
    why: "교사 개인은 자비로 결제하므로 기관 1:1 콜 같은 고비용 핸들링이 안 됩니다. 1:N 자동화 시퀀스(이메일·인앱 푸시)로 가입 → 첫 가치 → 7일 retention 흐름을 만들어야 합니다.",
    description:
      "B2C 자동 시퀀스 5단계: ① D0: 환영 이메일 + 5분 첫 가치 가이드 ② D1: 학급에서 바로 쓸 수 있는 활동 1개 추천 ③ D3: 비슷한 학년 교사들의 사례 ④ D7: 첫 진단 결과 리포트 ⑤ D14: 무료 → 유료 전환 제안. 각 단계별 open rate·click rate·conversion 측정. ‘완료’ 기준: 5단계 시퀀스 라이브 + 가입 → 유료 전환 funnel 측정 시작.",
    cadence: "once",
    tier: "must",
    domain: "A4",
    auto: { kind: "manual_only" },
    boost_domains: ["A4", "A6"],
    escalation_hint: "월 가입 300명+ 시 D14 외에 D30·D60 reactivation 추가",
  },
  {
    id: "ops.l.plc_first_meeting",
    team: "operations",
    phase: "launch",
    title: "PLC 첫 모임 운영 가이드 + 동행",
    why: "첫 모임이 어색하면 그룹 90%는 2주 안에 자연 소멸 — 운영팀 동행 필수.",
    cadence: "as_needed",
    tier: "must",
    auto: { kind: "manual_only" },
  },

  // ── Growth ─────────────────────────────────────────────────
  {
    id: "ops.g.action_d_minus_3",
    team: "operations",
    phase: "growth",
    title: "액션 follow-up KPI 점검 (D-3 알림)",
    why: "마감 하루 전 점검은 늦음 — D-3에 위험 신호를 잡아야 만회 가능.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "no_overdue_actions" },
  },
  {
    id: "ops.g.nrr_monthly",
    team: "operations",
    phase: "growth",
    title: "기존 고객 잔존·확장(NRR)·이탈(Churn) 월간 리뷰",
    why: "기존 고객이 떠나는 속도가 새 고객을 데려오는 속도보다 빠르면, 마케팅 예산을 아무리 써도 매출은 제자리입니다. NRR(Net Revenue Retention)이 85% 미만이면 신규 획득보다 이탈 방어가 더 급함.",
    description:
      "공식: NRR = (지난 12개월 시작 시점 고객들의 이번 달 매출 ÷ 그 고객들의 12개월 전 매출) × 100%. 100% 이상 = 이탈 + upsell 합쳐 매출이 자연 증가. Churn rate = 이번 달 이탈 고객 ÷ 지난 달 말 활성 고객. 매월 1일 둘 다 산출해서 운영 회의에서 공유. ‘완료’ 기준: NRR·Churn 월간 자동 산출 + 85% 미만 시 알림.",
    cadence: "monthly",
    tier: "recurring",
    domain: "A13",
    auto: { kind: "evidence_recorded_for", code: "A13" },
  },
  {
    id: "ops.g.teacher_satisfaction",
    team: "operations",
    phase: "growth",
    title: "교사 만족도 분기 설문 (NPS · 시간 절약 · 계속 사용 의사)",
    why: "교사 결정자 만족도가 본 서비스의 핵심 지표입니다. NPS · 주당 시간 절약 · 다음 학기 계속 사용 의사 3개를 분기마다 분리 측정해야 어느 신호가 약해지는지 잡힙니다. (선택 보조: 원장·학부모 의견은 별도 단발 인터뷰로 수집)",
    cadence: "quarterly",
    tier: "recurring",
    domain: "A3",
    auto: { kind: "evidence_recorded_for", code: "A3" },
  },
  {
    id: "ops.g.qbr",
    team: "operations",
    phase: "growth",
    title: "분기 비즈니스 리뷰(QBR) — 핵심 고객(HVA) 대상",
    why: "갱신 시점에 ‘우리가 얼마나 도움됐는지’를 처음 증명하면 늦습니다. 분기마다 미리 효과·KPI를 함께 점검해야 갱신·확장 협상력이 생깁니다.",
    description:
      "ⓘ 용어 풀이\nQBR = Quarterly Business Review = 분기 1회 핵심 고객과 함께 ‘이 분기 우리 서비스가 어떤 효과를 만들었나’를 점검하는 회의.\nHVA = High Value Account = 매출 상위 또는 영향력 큰 고객 (보통 매출의 80%를 만드는 상위 20%).\n\n⚙ 어떻게 하는가\n분기 첫 달에 HVA 고객 5–10곳 선정 → 각 고객에게 1시간 미팅 제안 → 미팅 자료 1장 슬라이드 (① 그 분기 사용량 추세 ② 핵심 KPI 변화 ③ 다음 분기 권장 사용 패턴). 미팅에서 갱신 의향·확장 의사 점검 + 불만 사항 수집.\n\n✔ 완료 기준\nHVA 5+ 고객과 분기마다 QBR 미팅 + 갱신 risk 평가 + 다음 분기 expansion 기회 1+ 발굴.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "ops.g.upsell_signals",
    team: "operations",
    phase: "growth",
    title: "Up-sell 시그널 분기 점검 (사용량 한도 도달)",
    why: "기존 고객 확장이 신규 획득 대비 CAC 1/5 — 시그널 못 잡으면 매출 기회 leak.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    escalation_hint: "유료 가입자 목표 300명+ 시 월간으로 가속",
  },
  {
    id: "ops.g.plc_monthly_review",
    team: "operations",
    phase: "growth",
    title: "월간 PLC 활동 리뷰 + 리더 코칭",
    why: "리더가 운영 의지를 잃으면 그룹 전체가 한 달 안에 비활성화 — 매월 동행.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    escalation_hint: "PLC 목표 50개+ 시 격주 리뷰 권장",
  },
  {
    id: "ops.g.paid_conversion_monitor",
    team: "operations",
    phase: "growth",
    title: "유료 전환 funnel 주간 모니터",
    why: "전환 funnel의 각 단계 drop-off를 매주 안 보면 한 단계 broken을 한 분기 방치.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },

  // ── Ops ────────────────────────────────────────────────────
  {
    id: "ops.o.weekly_digest",
    team: "operations",
    phase: "ops",
    title: "주간 디지스트 발송 (월요일 07:00)",
    why: "운영 루프가 사람 손에 의존하면 한 명 휴가에 멈춤 — 자동화 점검.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "ops.o.cs_categorize",
    team: "operations",
    phase: "ops",
    title: "CS 티켓 카테고리 분류 + 디자인팀 공유",
    why: "분류 안 된 CS 데이터는 패턴이 안 보이고, 패턴 없으면 UX 우선순위 불가.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "ops.o.sla_monitor",
    team: "operations",
    phase: "ops",
    title: "고객 SLA(긴급도별 응답·해결 시간) 매주 모니터",
    why: "SLA 위반 1건이 다음 갱신 협상에서 ‘가격 깎아주세요’ 카드로 돌아옵니다. 위반이 생기기 전에 매주 추세를 봐야 합니다.",
    description:
      "ⓘ 용어 풀이\nSLA = Service Level Agreement = 고객·계약 대상으로 약속한 서비스 수준 (응답 시간·해결 시간·가용성).\n긴급도(P0/P1/P2/P3): P0 = 서비스 전체 다운, P1 = 핵심 기능 장애, P2 = 일부 불편, P3 = 일반 문의.\n예: P0 → 15분 응답·1시간 해결, P1 → 1시간 응답·8시간 해결.\n\n⚙ 어떻게 하는가\nCS 도구(Intercom·Front·자체 시스템)에서 티켓을 P0–P3 자동 분류. 응답·해결 시간을 매주 집계 → SLA 위반 건수와 사유를 시계열 그래프로. 위반율 5% 넘으면 운영팀 회의 안건.\n\n✔ 완료 기준\n주간 SLA 대시보드 자동 갱신 + 위반 건수·사유 분류 + HVA 고객 위반 시 즉시 사과 메일·root cause 보고.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "ops.o.help_center_refresh",
    team: "operations",
    phase: "ops",
    title: "Help Center 콘텐츠 월간 갱신",
    why: "기능 변경 후 문서 업데이트 안 하면 CS 티켓이 같은 질문으로 채워짐.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "ops.o.churn_signals",
    team: "operations",
    phase: "ops",
    title: "갱신 위험 신호 모니터 (사용량 감소)",
    why: "사용량 30% 감소가 90일 이상 지속 = 갱신 안 함의 leading indicator.",
    cadence: "weekly",
    tier: "recurring",
    domain: "A13",
    auto: { kind: "manual_only" },
  },

  // ════════════════════════════════════════════════════════════
  //  마케팅팀 / MARKETING
  // ════════════════════════════════════════════════════════════
  // ── Foundation ─────────────────────────────────────────────
  {
    id: "mkt.f.brand_guideline",
    team: "marketing",
    phase: "foundation",
    title: "브랜드 가이드라인 1.0 (로고·컬러·톤·금기어) 작성",
    why: "‘우리 회사 자료’가 보는 사람마다 ‘이거 어디 회사 거지?’로 느껴진다면, 마케팅 비용의 절반은 사라집니다. 기준 없이는 일관된 인상을 못 만듭니다.",
    description:
      "ⓘ 용어 풀이\n브랜드 가이드라인 = ‘우리 브랜드를 어떻게 보여줘야 하는가’를 정한 문서. 외주·신입·디자이너·마케터 누구든 보면 같은 결과를 만들 수 있게.\n주요 섹션: ① 로고 (사용 가능 형태·여백·금지 사용) ② 컬러 팔레트 (primary/accent/neutral/signal) ③ 타이포그래피 ④ 톤 앤 매너 (말투·문장 길이·이모지 정책) ⑤ 사진/일러스트 스타일 ⑥ 금기어 ⑦ 사용 예/잘못된 예.\n\n⚙ 어떻게 하는가\nFigma·Notion에 1장씩 정리. 외주 제작 의뢰 시 첨부 필수. 분기마다 ‘새로 만든 자료가 가이드라인 따랐나’ 회고.\n\n✔ 완료 기준\n외부 자료(랜딩·광고·자료집) 80% 이상이 가이드라인 검수 통과 + 신규 디자이너 첫 주에 가이드라인만으로 헤더 이미지 1개 만들 수 있음.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.f.persona",
    team: "marketing",
    phase: "foundation",
    title: "교사 결정자 페르소나 정의 (1차)",
    why: "페르소나 없이는 메시지가 ‘모두를 위한’ → 결국 ‘아무도 안 듣는’. 본 서비스의 결정자는 교사 본인 — 직무·기관 유형·핵심 페인·구매 동기를 한 줄로 정의해야 채널·메시지가 정확히 맞춰집니다. (참고: 기관 결제 흐름에서는 원장이 결제 승인을 처리하지만, 사용·계속 사용 의사결정은 교사에게 있습니다.)",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.f.teacher_b2c_channels",
    team: "marketing",
    phase: "foundation",
    title: "교사 개인 결제자(B2C) 마케팅 채널 매핑",
    why: "교사 개인이 자비로 월 1–3만원 결제하는 구매 흐름은 기관 영업과 채널이 완전히 다릅니다. 인디스쿨·키즈비즈·교사 인스타그램·유튜브·카카오 오픈채팅 — 각 채널의 진입 비용·CAC를 따로 측정해야 합니다.",
    description:
      "교사 개인 구매자에게 닿는 채널 우선순위: ① 인디스쿨·키즈비즈 (커뮤니티 가입형) ② 교사 인스타그램·유튜브 인플루언서 (협찬형) ③ 카카오 오픈채팅 학년/지역 모임 ④ 전국 교원 연수 부스 ⑤ 학교/유치원 단체 메일링. 채널별 CAC·전환율 시트를 만들어 매월 업데이트. ‘완료’ 기준: 5개 채널 중 최소 2개에서 첫 유료 가입 발생 + 채널별 CAC 지표 수집 시작.",
    cadence: "once",
    tier: "must",
    domain: "A6",
    auto: { kind: "manual_only" },
    boost_domains: ["A6", "A10"],
  },
  {
    id: "mkt.l.teacher_b2c_pricing",
    team: "marketing",
    phase: "launch",
    title: "교사 개인 결제 플랜(B2C) 가격 설계",
    why: "기관 일괄 구매 가격(연간 수십만~수백만원)을 교사 개인에게 그대로 노출하면 결제 0건. 월 1–3만원대 개인 플랜 + 연간 결제 할인 + 무료 체험 기간 — 자비 결제자에게 맞는 진입 장벽으로 다시 설계해야 합니다.",
    description:
      "B2C 가격 설계: ① 무료 체험 7–14일(카드 등록 없이) ② 월간 1.5–2.9만원 (Van Westendorp 적정가 분석) ③ 연간 결제 시 2–3개월 무료 ④ 교사 인증(@school 이메일) 시 추가 할인 ⑤ PLC 그룹 리더는 본인 무료 + 멤버 할인. 매주 가입 → 무료 체험 → 유료 전환 funnel을 보면서 어디서 막히는지 점검. ‘완료’ 기준: B2C 플랜 가격 페이지 라이브 + 무료 → 유료 전환율 측정 시작.",
    cadence: "once",
    tier: "must",
    domain: "A3",
    auto: { kind: "manual_only" },
    boost_domains: ["A3", "A6"],
    escalation_hint: "월 유료 가입자 100명+ 시 가격 A/B 분기 1회",
  },
  {
    id: "mkt.f.regulatory_messaging",
    team: "marketing",
    phase: "foundation",
    title: "누리과정·평가제 메시징 적합성 검토",
    why: "기관 영업에서: 공보육화·평가지표 미반영 메시지 = 원장 거부 1순위. 교사 개인 영업에서도: 누리과정 영역에 도움된다는 점이 명시 안 되면 ‘회사가 우리 일을 모른다’ 인상.",
    cadence: "quarterly",
    tier: "must",
    domain: "A7",
    auto: { kind: "manual_only" },
  },

  // ── Launch ─────────────────────────────────────────────────
  {
    id: "mkt.l.message_test",
    team: "marketing",
    phase: "launch",
    title: "포지셔닝 메시지 분기 테스트 (April Dunford 5단계 프레임)",
    why: "‘우리는 무엇이고 누구에게 왜 다른가’ 한 문장이 흐릿하면, 어떤 채널·광고·콘텐츠를 해도 효율은 운에 맡긴 것입니다.",
    description:
      "ⓘ 용어 풀이\nApril Dunford = ‘Obviously Awesome’ 저자. 포지셔닝 정의 5단계 프레임을 만든 컨설턴트.\n  1. Competitive alternatives (사용자가 우리 대신 쓰는 것)\n  2. Unique attributes (우리만 가진 특성)\n  3. Value (그 특성이 사용자에게 주는 가치)\n  4. Best for whom (그 가치를 가장 원하는 사람)\n  5. Market category (어느 카테고리에 속하나)\n\n⚙ 어떻게 하는가\n5 질문에 1줄씩 답해 5장 슬라이드 → 헤드라인 후보 3개 도출 → 광고/랜딩 A/B로 클릭률·전환율 비교. 사람 30명+에게 ‘이 메시지 보고 우리가 뭐 하는 회사 같은가?’ 인터뷰.\n\n✔ 완료 기준\n분기 1회 5문항 답변 갱신 + 헤드라인 A/B 결과 → 가장 잘 된 메시지가 랜딩·광고에 반영.",
    cadence: "quarterly",
    tier: "recurring",
    domain: "A10",
    auto: { kind: "evidence_recorded_for", code: "A10" },
  },
  {
    id: "mkt.l.repeatable_channels",
    team: "marketing",
    phase: "launch",
    title: "반복 가능한 획득 채널 2개 이상 확보",
    why: "단일 채널 의존(예: 인스타그램 광고만)은 알고리즘·정책 변경 한 번이면 매출이 즉시 0. 채널 2개+가 안전망입니다.",
    description:
      "ⓘ 용어 풀이\n반복 가능한 채널 = ‘예측 가능한 비용·전환율로 사용자를 데려올 수 있는 경로’. 예측 안 되는 입소문이나 이벤트 한 번은 ‘반복 가능’이 아님.\n채널 후보: ① 검색 광고 (Google·네이버) ② SNS 광고 (Instagram·Facebook·YouTube) ③ 콘텐츠 SEO (블로그·유튜브) ④ 커뮤니티 (인디스쿨·맘카페) ⑤ 리퍼럴 ⑥ 컨퍼런스/이벤트.\n\n⚙ 어떻게 하는가\n분기별 채널 실험 — 각 채널에 5–10만원 부담 가능한 예산으로 2주 시도 → 결과 기록 (CAC, 전환율, payback). ‘반복 가능’ 기준: ① 같은 비용 투입 시 비슷한 결과가 다음 주에도 재현 ② 예측 가능한 전환 funnel ③ 확장 가능한 비용 한도가 명확.\n\n✔ 완료 기준\n반복 가능 기준 통과한 채널 2개+ 확보 + 채널별 CAC·LTV 시계열 시트.",
    cadence: "as_needed",
    tier: "must",
    domain: "A6",
    auto: { kind: "evidence_recorded_for", code: "A6" },
    escalation_hint: "월 목표 500명+ 시 채널 3개 이상 권장",
  },
  {
    id: "mkt.l.brand_landing_ab",
    team: "marketing",
    phase: "launch",
    title: "브랜드 랜딩 A/B 테스트 (분기)",
    why: "전환율 1pt 차이가 CAC payback을 24→18개월로 — 가장 cost-effective 레버.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    escalation_hint: "월 목표 300명+ 시 월간으로 가속",
  },
  {
    id: "mkt.l.community_listen",
    team: "marketing",
    phase: "launch",
    title: "교사 커뮤니티 신호 청취 (주간)",
    why: "한국 영유아 EdTech 입소문은 교사 커뮤니티에서 결정됩니다. 교사 카페(예: 인디스쿨, 키더 매트, 보육교사 카페) 의 신호를 매주 읽어야 광고보다 강한 진짜 평판이 보입니다.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.l.teacher_leader_marketing",
    team: "marketing",
    phase: "launch",
    title: "교사 리더 모집 마케팅 (PLC)",
    why: "리더 모집은 일반 회원 모집과 다른 채널·메시지 필요 — 별도 운영.",
    cadence: "quarterly",
    tier: "must",
    auto: { kind: "manual_only" },
    escalation_hint: "PLC 목표 30개+ 시 월간 모집 캠페인 권장",
  },

  // ── Growth ─────────────────────────────────────────────────
  {
    id: "mkt.g.cac_payback",
    team: "marketing",
    phase: "growth",
    title: "광고비 회수 기간(CAC payback) 월간 점검",
    why: "교사 한 명을 데려오는 데 든 광고비를, 그 교사의 매출로 회수하는 데 몇 개월 걸리는지가 ‘마케팅이 효율적인가’의 기본 지표입니다. 24개월 넘으면 자생력에 큰 부담.",
    description:
      "공식: CAC payback (개월) = (월 광고비 ÷ 그 달 신규 유료 고객 수) ÷ (유료 고객 1인의 월 평균 매출 × Gross Margin). 채널별로도 분리해서 봐야 평균 뒤에 숨은 ‘새는 채널’이 보입니다. ‘완료’ 기준: 매월 1일 전체 + 채널별 CAC payback 자동 산출되는 시트/대시보드 + 24개월 초과 시 마케팅팀 알림.",
    cadence: "monthly",
    tier: "must",
    domain: "A5",
    auto: { kind: "evidence_recorded_for", code: "A5" },
    escalation_hint: "월 목표 500명+ 시 격주 점검",
  },
  {
    id: "mkt.g.channel_efficiency",
    team: "marketing",
    phase: "growth",
    title: "채널 효율 월간 리뷰 (CAC·LTV·payback)",
    why: "채널별 데이터 분리 안 하면 평균 뒤에 손실 채널이 숨음.",
    cadence: "monthly",
    tier: "recurring",
    domain: "A6",
    auto: { kind: "manual_only" },
    escalation_hint: "월 목표 500명+ 시 주간으로 가속",
  },
  {
    id: "mkt.g.content_calendar",
    team: "marketing",
    phase: "growth",
    title: "ICP에 맞춘 콘텐츠 캘린더 (월간)",
    why: "ICP 미정의 채널 콘텐츠는 ‘아무에게도 안 닿는’ 비용.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.g.case_study",
    team: "marketing",
    phase: "growth",
    title: "케이스 스터디 분기 1건 발행",
    why: "B2B EdTech: ‘다른 원에서 효과 봤다’가 영업 사이클 단축의 핵심.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    escalation_hint: "월 목표 300명+ 시 월 1건으로 가속",
  },
  {
    id: "mkt.g.creative_refresh",
    team: "marketing",
    phase: "growth",
    title: "광고 크리에이티브 분기 갱신",
    why: "동일 크리에이티브 8주 이상 = 피로 누적, CTR 30% 하락.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    escalation_hint: "월 목표 300명+ 시 월 1세트, 500명+ 시 격주",
  },
  {
    id: "mkt.g.plc_case_content",
    team: "marketing",
    phase: "growth",
    title: "PLC 사례 콘텐츠 — 분기 1건",
    why: "PLC(학습공동체)는 아직 새 카테고리 — 교사 본인의 성장 사례, 원장이 본 효과, 학부모 반응 3관점 사례 콘텐츠가 인지도의 8할.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },

  // ── Ops ────────────────────────────────────────────────────
  {
    id: "mkt.o.seo_audit",
    team: "marketing",
    phase: "ops",
    title: "콘텐츠 SEO 분기 점검 (검색엔진 노출 최적화)",
    why: "검색에서 상위 노출되는 트래픽은 광고비 0원의 retention 채널. 6개월 무시하면 organic 트래픽 50% 손실 발견하는 게 흔합니다.",
    description:
      "ⓘ 용어 풀이\nSEO = Search Engine Optimization = 검색 결과에서 상위 노출되도록 최적화.\nOrganic 트래픽 = 광고가 아닌 자연 검색 결과를 통해 들어오는 사용자.\n주요 SEO 요소: ① 페이지 속도 (Core Web Vitals) ② 메타 태그 (title·description) ③ 헤딩 구조 (H1·H2) ④ 구조화 데이터 (Schema.org) ⑤ 백링크 (다른 사이트의 링크) ⑥ 모바일 최적화.\n\n⚙ 어떻게 하는가\n도구: Google Search Console + Ahrefs/SEMrush(유료) 또는 Ubersuggest(무료). 분기마다: ① 핵심 키워드 30개의 검색 순위 변화 ② 주요 페이지의 Core Web Vitals ③ 깨진 링크·중복 콘텐츠 ④ 백링크 신규/감소.\n\n✔ 완료 기준\n분기 SEO 점검 보고서 + 핵심 키워드 30개 추적 + Core Web Vitals 모든 핵심 페이지 ‘Good’.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.o.newsletter",
    team: "marketing",
    phase: "ops",
    title: "뉴스레터 격주 발송",
    why: "교사·원장·학부모 모두에게 지속 접점 — 광고비 0원의 retention 채널. 3 세그먼트별 콘텐츠 비중을 분리해서 발송해야 효율적.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.o.utm_audit",
    team: "marketing",
    phase: "ops",
    title: "UTM 파라미터·전환 추적(Attribution) 정합성 분기 점검",
    why: "UTM이 누락되거나 중복되면 ‘어느 채널이 효과적인지’를 잘못된 데이터로 판단합니다. 결국 잘못된 채널에 예산을 더 붓게 됩니다.",
    description:
      "ⓘ 용어 풀이\nUTM = Urchin Tracking Module = URL에 붙이는 추적 파라미터 (utm_source, utm_medium, utm_campaign, utm_content, utm_term).\nAttribution = 한 사용자가 여러 광고를 본 후 가입했을 때 ‘어느 광고가 결정적이었나’를 매기는 모델 (last-click, first-click, linear, time-decay 등).\n\n⚙ 어떻게 하는가\n분기마다 점검: ① 모든 광고 URL에 표준 UTM 붙어있나 ② utm_source·medium 값이 통일되어 있나 (대소문자·동의어 혼재 금지) ③ 같은 캠페인 ID가 중복 안 되나 ④ Attribution 모델 일관 적용. URL 빌더 (Google UTM Builder 등) 사용 강제.\n\n✔ 완료 기준\nUTM 표준화 가이드 + 분기 점검 시 위반 0건 + 모든 채널 매출이 attribution 모델 기준 일치.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.o.competitor_messaging",
    team: "marketing",
    phase: "ops",
    title: "경쟁사 메시지 모니터 (분기)",
    why: "경쟁사가 새 카테고리 만들면 우리가 ‘대안’으로 밀림 — 사전 감지 필수.",
    cadence: "quarterly",
    tier: "recurring",
    domain: "A14",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.o.persona_refresh",
    team: "marketing",
    phase: "ops",
    title: "교사 페르소나 갱신 (반기)",
    why: "한국 영유아 교사 시장은 출생률·정책 변화로 변동이 빠릅니다. 6개월마다 교사 페르소나(직무·기관 유형·핵심 페인)를 갱신하지 않으면 메시지가 stale 해집니다.",
    cadence: "semi_annual",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.o.event_quarterly",
    team: "marketing",
    phase: "ops",
    title: "교사 컨퍼런스·연수 분기 1건 참여",
    why: "전국 교원 연수·교사 학습 공동체·보육 컨퍼런스 — 교사 결정자와 직접 만나는 오프라인 접점이 디지털 채널보다 신뢰 형성에 훨씬 강력합니다.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },
  {
    id: "mkt.o.referral_program",
    team: "marketing",
    phase: "ops",
    title: "교사 referral 프로그램 운영 (월간 점검)",
    why: "본 서비스 신규 획득 CAC의 70%는 교사 동료 추천 채널입니다. 추천한 교사·추천받은 교사 모두에게 명시적 인센티브(예: 다음 학기 무료 또는 콘텐츠 적립)를 분리 설계해야 지속 가능합니다.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    funnel_stage: "referral",
  },

  // ════════════════════════════════════════════════════════════
  //  AI 활용 업무 — 모든 팀이 AI 도구·역량으로 업무 가속
  // ════════════════════════════════════════════════════════════
  // ── Director ────────────────────────────────────────────────
  {
    id: "ai.dir.f.guideline",
    team: "director",
    phase: "foundation",
    funnel_stage: "internal",
    title: "AI 도구 사용 가이드라인 1.0 (보안·예산·승인 절차)",
    why: "AI 도구 무분별 도입 시 PII 누출·비용 폭증 — 전사 가이드라인 없이 사용 금지.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
    ai_leverage: "전사 AI 도입 정책의 기반",
  },
  {
    id: "ai.dir.o.tool_audit",
    team: "director",
    phase: "ops",
    funnel_stage: "internal",
    title: "AI 활용 가능 업무 분기 매핑 + 도구 채택 검토",
    why: "AI 발전 속도가 빠름 — 분기마다 ‘이 업무는 이제 AI로 가능’ 업데이트 안 하면 인력 비효율.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
  },

  // ── Planning ────────────────────────────────────────────────
  {
    id: "ai.plan.g.transcript",
    team: "planning",
    phase: "growth",
    funnel_stage: "retention",
    title: "AI로 사용자 인터뷰 transcript 자동 분석·테마 추출 (월간)",
    why: "10명 인터뷰 = 5–8시간 정리 → AI로 30분. 인터뷰 횟수를 늘릴 수 있는 핵심 도구.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Whisper transcribe + Claude 분류·요약",
    escalation_hint: "월 인터뷰 10건+ 시 주간 분석으로 가속",
  },
  {
    id: "ai.plan.g.competitor_monitor",
    team: "planning",
    phase: "growth",
    funnel_stage: "awareness",
    title: "AI 기반 경쟁사 메시지·기능·가격 자동 모니터 (주간)",
    why: "경쟁사 변화를 사람이 추적하면 일관성 결여 + 놓침 — AI로 자동화 시 24h 내 감지.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "웹 스크래핑 + Claude diff 분석",
  },
  {
    id: "ai.plan.f.persona_sim",
    team: "planning",
    phase: "foundation",
    funnel_stage: "awareness",
    title: "AI persona 시뮬레이션 — 가설 검증 (월간)",
    why: "실제 인터뷰 전 AI persona로 메시지·기능 가설을 1차 검증 → 인터뷰 효율 3배.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude로 페르소나 역할극 + 응답 분석",
  },

  // ── Design ──────────────────────────────────────────────────
  {
    id: "ai.design.f.image_workflow",
    team: "design",
    phase: "foundation",
    funnel_stage: "internal",
    title: "AI 이미지·일러스트 생성 워크플로우 셋업",
    why: "외주 일러스트 의존 시 콘텐츠 발행 주기가 4주 → AI로 4시간. 콘텐츠 양 10배.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
    ai_leverage: "Midjourney/Flux + 브랜드 가이드라인 prompt",
  },
  {
    id: "ai.design.g.copy_ab",
    team: "design",
    phase: "growth",
    funnel_stage: "acquisition",
    title: "AI 카피 A/B 자동 생성 (헤드라인·CTA·메타)",
    why: "수동 카피 작성은 분기 5–10건 한계 — AI로 분기 100건 테스트 → 전환율 큰 폭 개선.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude로 페르소나별 카피 5종 자동 생성",
    escalation_hint: "월 목표 300명+ 시 주간 카피 갱신",
  },
  {
    id: "ai.design.g.ux_eval",
    team: "design",
    phase: "growth",
    funnel_stage: "activation",
    title: "AI 사용성 평가 agent — 화면 흐름 자동 리뷰",
    why: "내부 5명 사용성 테스트는 일정 잡기 어려움 — AI agent로 즉시 화면 평가 가능.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude vision + Nielsen 휴리스틱 평가",
  },

  // ── Engineering ─────────────────────────────────────────────
  {
    id: "ai.eng.f.copilot_guideline",
    team: "engineering",
    phase: "foundation",
    funnel_stage: "internal",
    title: "Cursor/Copilot 코드 리뷰 가이드라인",
    why: "AI 생성 코드의 보안·성능 검증 절차 없이 사용 시 회귀·취약점 폭증.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
    ai_leverage: "AI 코드 사용 정책",
  },
  {
    id: "ai.eng.g.test_gen",
    team: "engineering",
    phase: "growth",
    funnel_stage: "internal",
    title: "AI 기반 테스트 케이스 자동 생성",
    why: "테스트 작성이 개발 시간의 30% — AI 생성으로 50% 절감 + 커버리지 향상.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Cursor/Copilot으로 단위·통합 테스트 자동 생성",
  },
  {
    id: "ai.eng.o.regression",
    team: "engineering",
    phase: "ops",
    funnel_stage: "internal",
    title: "AI 코드 회귀 분석 (incident 후 자동)",
    why: "incident 원인 추적은 시간 잡아먹는 작업 — AI로 git log·diff 분석 자동화.",
    cadence: "as_needed",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude로 git diff 분석 + 가설 도출",
  },

  // ── Operations ──────────────────────────────────────────────
  {
    id: "ai.ops.l.cs_chatbot",
    team: "operations",
    phase: "launch",
    funnel_stage: "retention",
    title: "AI 1차 CS 응대 챗봇 (분류·라우팅·기본 답변)",
    why: "P3·P4 CS 80%가 반복 질문 — AI로 자동화 시 인력 비용 절반, 응답 시간 1/10.",
    cadence: "once",
    tier: "must",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude + 사내 KB RAG",
  },
  {
    id: "ai.ops.o.ticket_classify",
    team: "operations",
    phase: "ops",
    funnel_stage: "retention",
    title: "AI 기반 CS 티켓 자동 분류·tagging",
    why: "수동 분류는 15% 누락·일관성 없음 — AI 분류로 패턴 발견 정확도 3배.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude classification + 카테고리 트리",
  },
  {
    id: "ai.ops.o.digest",
    team: "operations",
    phase: "ops",
    funnel_stage: "internal",
    title: "AI 주간 디지스트 자동 초안 (월요일 06:00)",
    why: "디지스트 작성은 매주 2–3시간 — AI 초안 + 사람 검토로 30분 단축.",
    cadence: "weekly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude로 KPI·시그널 데이터 → narrative 변환",
  },

  // ── Marketing ───────────────────────────────────────────────
  {
    id: "ai.mkt.g.content_scale",
    team: "marketing",
    phase: "growth",
    funnel_stage: "awareness",
    title: "AI 콘텐츠 생성 (블로그·SNS) — 월 30건 스케일",
    why: "수동 발행은 월 5–8건 한계 — AI 초안 + 사람 편집으로 월 30건 가능 (organic 트래픽 5배).",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude + 브랜드 톤 + ICP 페르소나",
    escalation_hint: "월 목표 500명+ 시 월 60건으로 가속",
  },
  {
    id: "ai.mkt.g.ad_creatives",
    team: "marketing",
    phase: "growth",
    funnel_stage: "acquisition",
    title: "AI 광고 크리에이티브 자동 생성 (분기 100세트)",
    why: "크리에이티브 다양성 = CTR 핵심 — AI로 페르소나 × 메시지 × 비주얼 매트릭스 100건.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude(카피) + Midjourney(이미지) + 페르소나 매트릭스",
    escalation_hint: "월 목표 300명+ 시 월 40세트로 가속",
  },
  {
    id: "ai.mkt.o.seo_keywords",
    team: "marketing",
    phase: "ops",
    funnel_stage: "awareness",
    title: "AI 기반 SEO 키워드 발굴 (월간)",
    why: "수동 키워드 발굴은 누락 50%+ — AI로 long-tail까지 자동 매핑 → 트래픽 2배.",
    cadence: "monthly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude로 검색 의도 분류 + 클러스터링",
  },
  {
    id: "ai.mkt.g.persona_landing",
    team: "marketing",
    phase: "growth",
    funnel_stage: "acquisition",
    title: "AI persona별 랜딩 자동 생성 (분기 5종)",
    why: "한 랜딩으로는 페르소나별 전환 차이가 5–8배 — 페르소나별 랜딩이 ROI 가장 높음.",
    cadence: "quarterly",
    tier: "recurring",
    auto: { kind: "manual_only" },
    ai_leverage: "Claude + 헤드라인·증거·CTA 페르소나 변형",
  },
];

// ============================================================
// FUNNEL_BY_TASK_ID — 기존 업무들을 고객여정 단계에 매핑
// (신규 AI 업무는 task 자체에 funnel_stage 필드로 박혀 있음)
// ============================================================

export const FUNNEL_BY_TASK_ID: Record<string, FunnelStage> = {
  // Director
  "dir.f.mission": "internal",
  "dir.f.annual_targets": "internal",
  "dir.f.plc_business_model": "expansion",
  "dir.l.assign_owners": "internal",
  "dir.l.weekly_priority": "internal",
  "dir.l.go_to_market_thesis": "internal",
  "dir.g.monthly_revenue_review": "revenue",
  "dir.g.key_talent": "internal",
  "dir.g.external_expert": "internal",
  "dir.o.board_update": "internal",
  "dir.o.year_review": "internal",
  "dir.o.target_review": "internal",
  // Planning
  "plan.f.icp_one_liner": "awareness",
  "plan.f.competitor_mapping": "awareness",
  "plan.f.mom_test_script": "activation",
  "plan.f.plc_persona": "expansion",
  "plan.f.plc_playbook": "expansion",
  "plan.l.jtbd_interview": "activation",
  "plan.l.sean_ellis": "retention",
  "plan.l.aha_define": "activation",
  "plan.l.user_interviews": "retention",
  "plan.l.smart_action_24h": "internal",
  "plan.l.plc_data_schema": "expansion",
  "plan.f.buyer_segment_split": "awareness",
  "plan.g.retention_cohort": "retention",
  "plan.g.pricing_review": "revenue",
  "plan.g.competitive": "awareness",
  "plan.g.tradeoff_log": "internal",
  "plan.g.feature_dead_pool": "internal",
  "plan.g.plc_insight_review": "expansion",
  "plan.o.roadmap_retro": "internal",
  "plan.o.tam_refresh": "awareness",
  "plan.o.north_star_review": "internal",
  // Design
  "design.f.system": "internal",
  "design.f.a11y": "internal",
  "design.f.activation_setup": "activation",
  "design.f.empty_states": "activation",
  "design.f.plc_pages": "expansion",
  "design.f.teacher_personal_account": "activation",
  "design.l.onboarding_ab": "activation",
  "design.l.icp_onboarding": "activation",
  "design.l.ttv_short": "activation",
  "design.l.trust_review": "acquisition",
  "design.l.plc_activity_view": "expansion",
  "design.g.nps_inapp": "retention",
  "design.g.heatmap_review": "activation",
  "design.g.parent_page": "awareness",
  "design.g.privacy_readability": "acquisition",
  "design.g.paid_upgrade_ux": "revenue",
  "design.o.cs_pattern": "retention",
  "design.o.power_user_loop": "retention",
  "design.o.responsive_audit": "activation",
  "design.o.ab_report": "internal",
  // Engineering
  "eng.f.cicd": "internal",
  "eng.f.test_coverage": "internal",
  "eng.f.rls_setup": "internal",
  "eng.f.privacy_consent": "acquisition",
  "eng.l.kpi_stripe": "revenue",
  "eng.l.kpi_ga4": "acquisition",
  "eng.l.kpi_mixpanel": "activation",
  "eng.l.pii_redaction_test": "internal",
  "eng.l.plc_group_feature": "expansion",
  "eng.g.eval_pipeline": "internal",
  "eng.g.rag_refresh": "internal",
  "eng.g.dora": "internal",
  "eng.g.prompt_versioning": "internal",
  "eng.g.plc_kpi_pipeline": "expansion",
  "eng.o.kisa_self_audit": "internal",
  "eng.o.security_drill": "internal",
  "eng.o.handoff_monitor": "internal",
  "eng.o.slo_alerts": "retention",
  "eng.o.dr_check": "internal",
  // Operations
  "ops.f.runbook": "internal",
  "ops.f.help_center": "retention",
  "ops.f.teacher_leader_recruit": "expansion",
  "ops.l.action_owner_24h": "internal",
  "ops.l.first30_call": "activation",
  "ops.l.teacher_b2c_onboarding": "activation",
  "ops.l.plc_first_meeting": "expansion",
  "ops.g.action_d_minus_3": "internal",
  "ops.g.nrr_monthly": "retention",
  "ops.g.parent_survey": "retention",
  "ops.g.qbr": "expansion",
  "ops.g.upsell_signals": "expansion",
  "ops.g.plc_monthly_review": "expansion",
  "ops.g.paid_conversion_monitor": "revenue",
  "ops.o.weekly_digest": "internal",
  "ops.o.cs_categorize": "retention",
  "ops.o.sla_monitor": "retention",
  "ops.o.help_center_refresh": "retention",
  "ops.o.churn_signals": "retention",
  // Marketing
  "mkt.f.brand_guideline": "awareness",
  "mkt.f.persona": "awareness",
  "mkt.f.teacher_b2c_channels": "acquisition",
  "mkt.f.regulatory_messaging": "awareness",
  "mkt.l.teacher_b2c_pricing": "revenue",
  "mkt.l.message_test": "awareness",
  "mkt.l.repeatable_channels": "acquisition",
  "mkt.l.brand_landing_ab": "acquisition",
  "mkt.l.community_listen": "awareness",
  "mkt.l.teacher_leader_marketing": "acquisition",
  "mkt.g.cac_payback": "acquisition",
  "mkt.g.channel_efficiency": "acquisition",
  "mkt.g.content_calendar": "awareness",
  "mkt.g.case_study": "awareness",
  "mkt.g.creative_refresh": "acquisition",
  "mkt.g.plc_case_content": "expansion",
  "mkt.o.seo_audit": "awareness",
  "mkt.o.newsletter": "retention",
  "mkt.o.utm_audit": "acquisition",
  "mkt.o.competitor_messaging": "awareness",
  "mkt.o.persona_refresh": "awareness",
  "mkt.o.event_quarterly": "awareness",
};

// AI 활용 가능한 기존 업무 (신규 AI 업무는 task 자체에 ai_leverage 필드)
export const AI_LEVERAGE_BY_TASK_ID: Record<string, string> = {
  "plan.l.jtbd_interview": "AI transcript 분석·테마 추출 가능",
  "plan.l.user_interviews": "Whisper + Claude로 인터뷰 정리 자동화",
  "plan.l.sean_ellis": "AI로 응답 자동 분류·세그먼트 발견",
  "plan.f.competitor_mapping": "AI로 경쟁사 페이지·기능 자동 매핑",
  "plan.g.competitive": "AI로 win/loss 통화 분석",
  "design.o.cs_pattern": "AI 클러스터링으로 패턴 자동 발견",
  "design.g.heatmap_review": "AI로 세션 리플레이 자동 요약",
  "design.l.onboarding_ab": "AI로 onboarding 카피 변형 자동 생성",
  "mkt.g.content_calendar": "AI 콘텐츠 초안 자동 생성",
  "mkt.g.creative_refresh": "AI 이미지·카피 자동 생성",
  "mkt.o.seo_audit": "AI로 키워드·메타 자동 점검",
  "mkt.l.message_test": "AI로 메시지 변형 자동 생성·평가",
  "mkt.o.newsletter": "AI 초안 + 사람 검토 워크플로우",
  "ops.o.cs_categorize": "AI 분류 모델로 90% 자동화",
  "ops.o.weekly_digest": "AI 디지스트 자동 작성",
  "ops.o.help_center_refresh": "AI로 변경 사항 → 문서 자동 갱신 제안",
  "eng.f.test_coverage": "Cursor/Copilot으로 테스트 자동 생성",
  "eng.g.eval_pipeline": "AI 자체 평가 + 회귀 감지",
  "eng.g.prompt_versioning": "AI eval 결과 자동 비교",
};

/**
 * Get the funnel stage for a task — falls back to FUNNEL_BY_TASK_ID,
 * then defaults to "internal".
 */
export function getFunnelStage(t: Task): FunnelStage {
  return t.funnel_stage ?? FUNNEL_BY_TASK_ID[t.id] ?? "internal";
}

/**
 * Get the AI leverage hint for a task — checks the task itself, then
 * the AI_LEVERAGE_BY_TASK_ID map. Returns undefined if none.
 */
export function getAiLeverage(t: Task): string | undefined {
  return t.ai_leverage ?? AI_LEVERAGE_BY_TASK_ID[t.id];
}

// ============================================================
// Goals — 회사 목표 (목표 패널 client-side 저장)
// ============================================================

export interface Goals {
  yearEndMembers: number; // 연말 목표 회원수
  monthlyMembers: number; // 월 목표 회원수
  paidMembers: number; // 유료 가입자 목표
  plcGroups: number; // PLC 그룹 수 목표
  teacherLeaders: number; // 교사 리더 수 목표
  // current values (manual)
  currentMembers: number;
  currentPaid: number;
  currentPlc: number;
  currentTeacherLeaders: number;
}

export const GOAL_LABELS: Record<keyof Goals, string> = {
  yearEndMembers: "연말 목표 회원수",
  monthlyMembers: "월 목표 신규 회원수",
  paidMembers: "유료 가입자 목표",
  plcGroups: "PLC 그룹 수 목표",
  teacherLeaders: "교사 리더 수 목표",
  currentMembers: "현재 회원수",
  currentPaid: "현재 유료 가입자",
  currentPlc: "현재 PLC 그룹",
  currentTeacherLeaders: "현재 교사 리더",
};

export const DEFAULT_GOALS: Goals = {
  yearEndMembers: 0,
  monthlyMembers: 0,
  paidMembers: 0,
  plcGroups: 0,
  teacherLeaders: 0,
  currentMembers: 0,
  currentPaid: 0,
  currentPlc: 0,
  currentTeacherLeaders: 0,
};

// ============================================================
// Status types
// ============================================================

export type Status = "not_started" | "scheduled" | "in_progress" | "done";

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "안 함",
  scheduled: "예정",
  in_progress: "진행 중",
  done: "완료",
};

export const STATUS_ORDER: Status[] = [
  "not_started",
  "scheduled",
  "in_progress",
  "done",
];

// ============================================================
// Boost / live-impact helpers
// ============================================================

/**
 * 한 업무가 영향 주는 도메인 코드 목록.
 * task.boost_domains가 명시되어 있으면 그 목록, 없으면 task.domain (단일 항목),
 * 도메인도 없으면 빈 배열.
 */
export function getBoostDomains(t: Task): string[] {
  if (t.boost_domains && t.boost_domains.length > 0) return t.boost_domains;
  if (t.domain) return [t.domain];
  return [];
}

/**
 * 1개 업무 완료 시 boost_domains 각 도메인에 더해질 점수.
 * tier별 차등: must=12, conditional=10, recurring=6.
 * task.boost_points가 명시되어 있으면 그 값을 우선 사용.
 */
export function getBoostPoints(t: Task): number {
  if (typeof t.boost_points === "number") return t.boost_points;
  switch (t.tier) {
    case "must":
      return 12;
    case "conditional":
      return 10;
    case "recurring":
      return 6;
  }
}

// ============================================================
// Derived tasks + overrides (data-driven worklist transforms)
// ============================================================

/**
 * DerivedTask: 외부 데이터(GA4·Admin·NPS 등)에서 AI가 만들어낸 신규 업무.
 * Task와 같은 스키마를 따르되, 출처·생성 시각·신뢰도를 추가로 보관.
 */
export interface DerivedTask extends Task {
  /** 출처 시그널 식별자 — signal_events.id 또는 클라이언트 ULID */
  derived_from_signal: string;
  /** ISO timestamp */
  created_at: string;
  /** 한 cadence + 14일 후 자동 보관 권장 */
  auto_archive_at?: string;
  /** 0–1 — 0.6 미만이면 노란 경고 */
  confidence: number;
  /** 분석에서 들어온 원본 인사이트 한 줄 */
  source_insight: string;
}

/**
 * TaskOverride: 기존 catalog task의 cadence·tier·우선순위를 데이터 기반으로 격상.
 */
export interface TaskOverride {
  /** 기존 Task.id */
  task_id: string;
  /** 우선 적용될 새 cadence (catalog Cadence enum) */
  cadence_override?: Cadence;
  /** 우선 적용될 새 tier (must/conditional 격상 가능) */
  tier_boost?: Tier;
  /** 한 줄 — 왜 격상되었는지 (예: "신규 -39.4% 영향") */
  urgency_note?: string;
  /** 출처 시그널 식별자 */
  source_signal_id: string;
  /** ISO timestamp */
  created_at: string;
  /** 0–1 */
  confidence: number;
}

/**
 * MergedTask — 화면 렌더링용. base/derived 구분, override 적용 여부 표시.
 */
export type MergedTask = Task & {
  _kind: "base" | "derived";
  _override?: TaskOverride;
  _derived_meta?: { signal: string; insight: string; confidence: number };
};

/**
 * mergeTasks — 정적 catalog + 데이터 주도 derived + override 를 합쳐 화면용 배열로.
 *
 * - override 적용 task는 cadence/tier가 override 값으로 치환되고, _override 메타가 붙음.
 * - derived task는 _kind='derived' 로 표기되어 UI에서 🔥 배지로 노출.
 * - confidence 정보는 _override.confidence / _derived_meta.confidence 로 노출.
 */
export function mergeTasks(
  base: readonly Task[],
  derived: readonly DerivedTask[],
  overrides: readonly TaskOverride[],
): MergedTask[] {
  const overrideMap = new Map<string, TaskOverride>();
  for (const o of overrides) overrideMap.set(o.task_id, o);

  const out: MergedTask[] = [];
  for (const t of base) {
    const ov = overrideMap.get(t.id);
    if (ov) {
      out.push({
        ...t,
        cadence: ov.cadence_override ?? t.cadence,
        tier: ov.tier_boost ?? t.tier,
        _kind: "base",
        _override: ov,
      });
    } else {
      out.push({ ...t, _kind: "base" });
    }
  }
  for (const d of derived) {
    out.push({
      ...d,
      _kind: "derived",
      _derived_meta: {
        signal: d.derived_from_signal,
        insight: d.source_insight,
        confidence: d.confidence,
      },
    });
  }
  return out;
}

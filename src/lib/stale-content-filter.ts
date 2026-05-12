/**
 * Stale content filter — 카인더스틱 OS 범위 밖 콘텐츠 (자금·런웨이·IR) 의
 * DB stale row 를 운영 화면에서 일괄 숨기기 위한 헬퍼.
 *
 * 배경: 초기 14-도메인 설계 시 A5 (단위경제·자금) / A12 (자금·런웨이·IR) 가 포함되어
 *       coach 가 SMART 액션을 생성한 적이 있다. Appendix C 적용 후 두 도메인은
 *       제거됐지만, 이미 저장된 coaching_actions / agent_sessions 의 title/summary
 *       에 "VC", "투자자", "Seed", "런웨이" 같은 단어가 남아 사용자 화면에 노출됨.
 *
 * 영구 해결: DB 마이그레이션으로 status='abandoned' 처리.
 * 임시 해결 (현재): 표시 시점에 title/summary 텍스트 검사로 필터링.
 *
 * 사용: 서버 쿼리에서 row 가져온 후 .filter(r => !isStaleFinanceContent(r.title))
 */

const STALE_KEYWORDS = [
  // 한글
  "런웨이",
  "투자자",
  "투자 이력",
  "투자 라운드",
  "벤처투자",
  "IR ",
  " IR",
  "IR 자료",
  "IR 데크",
  "IR 미팅",
  "IR pipeline",
  "엔젤투자",
  "엔젤 투자",
  "term sheet",
  "텀시트",
  "bridge round",
  "브릿지 라운드",
  "vesting",
  "딜로지",
  "fundraise",
  "fundraising",
  "Burn Multiple",
  "Burn multiple",
  "burn multiple",
  "burn rate",
  "Burn rate",
  "단위경제",
  "Magic Number",
  "Rule of 40",
  // 영문
  "Pre-A",
  "Pre-seed",
  "Series A",
  "Series B",
  "venture debt",
  "Venture debt",
  "Bridge round",
  "Down round",
  "Term Sheet",
  "Valuation",
  "CAC payback",
  "Gross margin",
  "CAC Payback",
  // 결합 패턴
  "VC 30",
  "VC 5",
  "VC 10",
  "VC 50",
];

/**
 * 텍스트에 자금·IR 관련 키워드가 포함되어 있는지 검사.
 * coaching_actions.title, agent_sessions.summary 등에 사용.
 */
export function isStaleFinanceContent(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // "VC" 단독 단어 (조사 제외) — "VC ", " VC", "VC,", "VC." 등
  if (/\bvc\b/i.test(text)) return true;

  // 한글 "seed" 가 단계로 쓰인 경우 (영문 단어 경계로)
  if (/\bseed\b/i.test(text) && /라운드|단계|투자|round|funding/i.test(text)) {
    return true;
  }

  for (const kw of STALE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return true;
  }
  return false;
}

/**
 * 도메인 코드가 제거된 도메인(A5, A12) 인지.
 * 쿼리에서는 supabase `.not("domain_code", "in", "(A5,A12)")` 도 같이 쓰는 것이 안전.
 */
export function isRemovedDomain(domain_code: string | null | undefined): boolean {
  if (!domain_code) return false;
  return domain_code === "A5" || domain_code === "A12";
}

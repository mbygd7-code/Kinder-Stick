/**
 * Date utilities — 공용 헬퍼.
 *
 * Appendix H-2.4: daysAgo 가 3곳에서 중복되던 것을 통합.
 */

/** ISO 문자열 또는 Date 입력 → 오늘 기준 며칠 전인지. 음수면 미래. */
export function daysAgo(input: string | Date | null | undefined): number {
  if (!input) return 0;
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

/** "3일 전", "오늘", "1개월 전" 같은 한국어 상대 시간. */
export function relativeKo(input: string | Date | null | undefined): string {
  const n = daysAgo(input);
  if (n < 0) return "예정";
  if (n === 0) return "오늘";
  if (n === 1) return "어제";
  if (n < 7) return `${n}일 전`;
  if (n < 30) return `${Math.floor(n / 7)}주 전`;
  if (n < 365) return `${Math.floor(n / 30)}개월 전`;
  return `${Math.floor(n / 365)}년 전`;
}

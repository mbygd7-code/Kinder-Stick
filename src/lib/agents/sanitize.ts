/**
 * Markdown / 장식 기호 sanitizer.
 *
 * AI 출력에서 마크다운 포매팅 문자와 장식용 이모지를 제거해 평이한 한국어
 * 본문만 남긴다. 시각적 위계는 컴포넌트의 타이포그래피·여백·색이 담당하므로
 * 본문 안에서 별도 마크다운이 필요 없다.
 *
 * - **bold**, __bold__         → 본문
 * - *italic*, _italic_         → 본문
 * - ~~strike~~                 → 본문
 * - `inline code`              → 본문
 * - ```fenced code```          → 본문 (펜스만 제거)
 * - "# heading" (라인 시작)    → 본문
 * - "> quote" (라인 시작)      → 본문
 * - 마크다운 표 (| ... |)      → 점으로 평탄화
 * - 장식 기호 ❌ ✓ ✗ ☑ ☐ 🛡 등 → 제거
 *
 * 인라인 해시태그(#general 같은 Slack 채널명)는 보존하기 위해 # 은 라인 시작
 * + 공백 패턴에서만 제거한다.
 */

const DECORATIVE_SYMBOLS = /[✓✗❌☑☐■□🛡🎯🚪⚡🔁💰📣🌱🧭🔥🤖⏳📝📎🔗📄🚶📊📋⚠📚✨🔔💡⭐]/g;

function stripTables(text: string): string {
  // 1) 표 구분선 (예: "|---|---|") 제거
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (/^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?$/.test(trimmed)) continue;
    out.push(ln);
  }
  // 2) 표 행 ("| a | b |") → "a · b"
  return out
    .map((ln) => {
      // 라인이 |로 시작하거나 끝나는 경우만 표 행으로 간주
      const trimmed = ln.trim();
      if (!trimmed) return ln;
      const hasLeading = trimmed.startsWith("|");
      const hasTrailing = trimmed.endsWith("|");
      const pipeCount = (trimmed.match(/\|/g) ?? []).length;
      if ((hasLeading || hasTrailing) && pipeCount >= 2) {
        const cells = trimmed
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        return cells.join(" · ");
      }
      return ln;
    })
    .join("\n");
}

export function sanitizeMarkdown(text: string): string {
  if (!text) return text;
  let out = text;

  // 코드 펜스 제거 (펜스만, 내용은 유지)
  out = out.replace(/```[a-zA-Z0-9_-]*\s*\n?/g, "");
  out = out.replace(/```/g, "");

  // bold/italic 마커 제거 (내용 유지)
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, "$1");
  out = out.replace(/__([^\n_]+?)__/g, "$1");
  // 단일 *italic* / _italic_ — 단어 경계 안에서만
  out = out.replace(/(^|[^\w*])\*([^*\n]+?)\*(?=[^\w*]|$)/g, "$1$2");
  out = out.replace(/(^|[^\w_])_([^_\n]+?)_(?=[^\w_]|$)/g, "$1$2");

  // ~~strikethrough~~
  out = out.replace(/~~([^~\n]+?)~~/g, "$1");

  // 인라인 백틱 코드
  out = out.replace(/`([^`\n]+?)`/g, "$1");

  // 라인 시작 헤딩 / 인용 마커
  out = out.replace(/^\s*#{1,6}\s+/gm, "");
  out = out.replace(/^\s*>+\s*/gm, "");

  // 마크다운 표 평탄화
  out = stripTables(out);

  // 장식 기호 제거
  out = out.replace(DECORATIVE_SYMBOLS, "");

  // 다중 공백 정리
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/ +\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

/**
 * 짧은 라인 (제목·라벨)에는 줄바꿈 보존이 불필요하므로 추가로 모든 공백을
 * 한 칸으로 압축한다.
 */
export function sanitizePlain(text: string): string {
  return sanitizeMarkdown(text).replace(/\s+/g, " ").trim();
}

/**
 * 샘플 템플릿 등 들여쓰기·줄바꿈을 그대로 살려야 하는 본문에 사용. 마크다운
 * 마커·장식 기호만 제거하고, 공백은 라인 끝 trailing 공백만 정리.
 */
export function sanitizePreservingIndent(text: string): string {
  if (!text) return text;
  let out = text;

  // 코드 펜스 (펜스만 제거, 내용은 유지)
  out = out.replace(/```[a-zA-Z0-9_-]*\s*\n?/g, "");
  out = out.replace(/```/g, "");

  // bold/italic/strike/code 마커만 제거 (내용 유지)
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, "$1");
  out = out.replace(/__([^\n_]+?)__/g, "$1");
  out = out.replace(/(^|[^\w*])\*([^*\n]+?)\*(?=[^\w*]|$)/g, "$1$2");
  out = out.replace(/(^|[^\w_])_([^_\n]+?)_(?=[^\w_]|$)/g, "$1$2");
  out = out.replace(/~~([^~\n]+?)~~/g, "$1");
  out = out.replace(/`([^`\n]+?)`/g, "$1");

  // 라인 시작 헤딩 / 인용
  out = out.replace(/^\s*#{1,6}\s+/gm, "");
  out = out.replace(/^\s*>+\s*/gm, "");

  // 마크다운 표 평탄화 (들여쓰기 보존)
  const lines = out.split(/\r?\n/);
  const next = lines
    .filter(
      (ln) => !/^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?$/.test(ln.trim()),
    )
    .map((ln) => {
      const t = ln.trim();
      const hasLeading = t.startsWith("|");
      const hasTrailing = t.endsWith("|");
      const pipeCount = (t.match(/\|/g) ?? []).length;
      if ((hasLeading || hasTrailing) && pipeCount >= 2) {
        // preserve leading whitespace of original line
        const indent = ln.match(/^\s*/)?.[0] ?? "";
        const cells = t
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        return indent + cells.join(" · ");
      }
      return ln;
    });
  out = next.join("\n");

  // 장식 기호 제거
  out = out.replace(DECORATIVE_SYMBOLS, "");

  // 줄 끝 trailing 공백 + 3개 이상 연속 빈 줄 정리
  out = out.replace(/[ \t]+$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.replace(/^\s+|\s+$/g, "");
}

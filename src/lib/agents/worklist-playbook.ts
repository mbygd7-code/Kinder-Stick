/**
 * Worklist Playbook — task별로 직원이 바로 실행에 옮길 수 있는 실무 자료를
 * AI(Claude haiku-4-5)로 생성한다.
 *
 * 출력은 **마크다운 섹션 포맷**으로 받는다. 이유:
 *   - JSON은 본문 안에 따옴표·줄바꿈 등이 들어가면 escape 실수가 많고
 *     `max_tokens` 한도에서 잘리면 그 길이까지의 JSON이 통째로 invalid 됨.
 *   - 마크다운 섹션은 부분 truncate에도 강함 (마지막 섹션만 잘리고 앞은 그대로
 *     쓸 수 있음).
 *   - 본문에 따옴표·코드·표를 자유롭게 넣어도 안전.
 *
 * 섹션 형식:
 *   ## SUMMARY
 *   한 문장
 *
 *   ## OUTPUT
 *   산출물 설명
 *
 *   ## STEP 1: 단계 제목 | 담당 | 예상 2h
 *   구체 작업 내용
 *
 *   ## KPI: 지표명
 *   목표: 임계값
 *   측정: 어디서 어떻게
 *
 *   ## SAMPLE
 *   (템플릿 전체)
 *
 *   ## PITFALL
 *   실수 + 대안
 *
 *   ## REFERENCE
 *   참고 자료
 */

import { anthropic } from "@/lib/anthropic";
import {
  sanitizeMarkdown,
  sanitizePlain,
  sanitizePreservingIndent,
} from "@/lib/agents/sanitize";

export interface PlaybookInput {
  task_id: string;
  title: string;
  why: string;
  team: string;
  phase: string;
  funnel_stage?: string;
  cadence: string;
  tier: string;
  domain?: string;
  hint?: string;
  ai_leverage?: string;
}

export interface PlaybookKPI {
  name: string;
  threshold: string;
  method: string;
}

export interface PlaybookStep {
  title: string;
  detail: string;
  owner?: string;
  estimated_hours?: number;
}

export interface PlaybookOutput {
  summary: string;
  output: string;
  steps: PlaybookStep[];
  kpis: PlaybookKPI[];
  sample: string;
  pitfalls: string[];
  references: string[];
  model: string;
  generated_at: string;
}

function buildSystemPrompt(): string {
  return [
    "당신은 한국 영유아 EdTech 스타트업의 운영진을 돕는 시니어 코치이자 실무 매니저입니다.",
    "특정 업무 한 개를 받으면, 그 업무를 직원이 바로 실행할 수 있도록 풍부한 자료를 만듭니다.",
    "",
    "## 작성 규칙",
    "- 한국 영유아 EdTech 시장 (어린이집·유치원·학부모·교사·누리과정·평가제·KISA) 맥락에 맞춤.",
    "- 영어 약어(PMF, CAC, JTBD 등)는 처음 등장 시 괄호로 풀어 설명.",
    "- 추상적 표현 금지 — '구체적으로'·'예를 들어'·'X명에게'·'Y개월'·'Z%' 같은 수치/예시를 반드시 포함.",
    "- 샘플 템플릿은 진짜 사용 가능해야 함. 빈칸 + 작성 예시(2-3줄) 포함.",
    "- KPI는 (지표명, 임계값, 측정 방법) 3요소를 모두 명시.",
    "- 단계는 3-6개. 각 단계는 (제목, 담당, 예상 시간, 상세).",
    "",
    "## 본문 포매팅 절대 금지 (매우 중요)",
    "본문에서 다음 문자/마크다운 포매팅을 절대 사용하지 마세요. 본문 안 강조는 평이한 한국어로 표현하세요:",
    "- 굵게/기울임 마커: ** __ * _ ~~ 사용 금지. (예: '**중요**' 대신 '핵심: 중요')",
    "- 인라인 코드 백틱 ` 사용 금지",
    "- 코드펜스 ``` 사용 금지 (섹션 헤더 ## 외)",
    "- 마크다운 표 (| ... |) 사용 금지. 항목은 ' · ' 또는 줄바꿈으로 구분.",
    "- 마크다운 헤딩 # ## ### 은 섹션 헤더용 (## SUMMARY 등)에만 사용. 본문에는 절대 금지.",
    "- 인용 표시 > 사용 금지.",
    "- 장식 기호 ❌ ✓ ✗ ☑ ☐ 🛡 ✨ ⚡ 🔥 등 모든 이모지/장식 문자 사용 금지.",
    "- 강조하려면 평이한 한국어로: '핵심:', '주의:', '예:', '결과:' 같은 라벨을 한국어로 직접 쓰기.",
    "",
    "## 출력 형식",
    "- 출력은 반드시 아래 섹션 형식만 사용 (JSON·코드펜스·다른 텍스트 금지).",
    "- 각 섹션 본문은 평이한 한국어 문장. 줄바꿈은 의미 단위로만.",
    "",
    "## 출력 형식 (각 섹션 헤더는 반드시 '## ' 로 시작)",
    "",
    "## SUMMARY",
    "한 문장 — 이 업무가 만들어내는 결과물과 왜 중요한지.",
    "",
    "## OUTPUT",
    "산출물 형태와 누가 보는지. 예: 'Notion 1페이지 문서 + 팀 전체 공유. 대표·PM·디자이너가 보며, 신입 온보딩 자료로 활용.'",
    "",
    "## STEP 1: 단계 제목 | 담당: 직무명 | 예상: Nh",
    "구체 작업 내용 (2-4 문장, 실제 예시 포함).",
    "",
    "## STEP 2: 단계 제목 | 담당: 직무명 | 예상: Nh",
    "...",
    "",
    "## KPI: 지표명",
    "목표: 임계값 (예: ≥40%, ≤24시간, n≥30)",
    "측정: 측정 방법 (어디서·어떻게 수집)",
    "",
    "## KPI: 다른 지표명",
    "...",
    "",
    "## SAMPLE",
    "직원이 그대로 복사해서 채워 쓸 수 있는 템플릿 전체.",
    "빈칸은 [...] 또는 'XX'로, 작성 예시는 (예: ...) 로 표기.",
    "줄바꿈 자유롭게.",
    "",
    "## PITFALL",
    "실수 1 (왜 실수인지) — 대안: 한 줄로.",
    "",
    "## PITFALL",
    "실수 2 — 대안.",
    "",
    "## REFERENCE",
    "참고 출처 1 (책·기사·KISA 가이드 등)",
    "",
    "## REFERENCE",
    "참고 출처 2",
    "",
    "",
    "## 좋은 예 — task 'Go-to-Market 가설 1장 + 검증 KPI'",
    "",
    "## SUMMARY",
    "GTM(Go-to-Market) 가설을 1페이지 문서로 정리하면 채널·메시지·ICP(이상적 고객 프로필) 합의가 빨라지고 마케팅 예산 분산을 막을 수 있습니다.",
    "",
    "## OUTPUT",
    "Notion 1페이지 GTM 가설 문서 + 6주 후 KPI 점검 미팅 자료. 대표·마케팅 리드·PM이 합의하고 모든 마케팅 결정의 기준점으로 사용합니다.",
    "",
    "## STEP 1: ICP 정의 | 담당: 대표 + PM | 예상: 3h",
    "고객 5-8명 인터뷰 결과를 바탕으로 한 줄로 ICP를 정의합니다. 예: 가정어린이집 원장, 정원 20명 미만, 학부모 알림장 작성에 매일 1시간 이상 소비. 추상적인 '교사' 같은 표현 금지 — 직무·기관 규모·핵심 페인을 반드시 포함.",
    "",
    "## KPI: 채널별 CAC (고객획득비)",
    "목표: < 50,000원 (광고비 ÷ 신규 유료 사용자)",
    "측정: GA4 + 자사 결제 DB에서 채널별로 6주차에 한 번 측정.",
    "",
    "## SAMPLE",
    "[Go-to-Market 가설 1-pager]",
    "",
    "1. 누구를 (ICP)",
    "   - 직무: [예: 가정어린이집 원장]",
    "   - 기관 규모: [예: 정원 20명 미만]",
    "   - 페인: [예: 학부모와 매일 사진 공유에 1시간 소비]",
    "",
    "2. 무엇을 (가치 제안)",
    "   - 한 문장: [예: XXX은 학부모 알림장을 자동 생성해 매일 1시간을 돌려줍니다.]",
    "",
    "## PITFALL",
    "ICP를 '교사 전체' 같이 광범위하게 정의하면 메시지가 무게 없어짐. 대안: 직무·기관 규모·페인 3요소를 모두 명시한 한 줄로.",
    "",
    "## REFERENCE",
    "April Dunford, Obviously Awesome (Positioning Framework)",
  ].join("\n");
}

// ============================================================
// Parser
// ============================================================

interface RawSection {
  kind:
    | "SUMMARY"
    | "OUTPUT"
    | "STEP"
    | "KPI"
    | "SAMPLE"
    | "PITFALL"
    | "REFERENCE"
    | "UNKNOWN";
  header: string; // 전체 헤더 텍스트 (## 뒤)
  body: string;
}

function splitSections(raw: string): RawSection[] {
  // 코드펜스 ```...``` 를 일단 제거 (AI가 가끔 감싸서 보냄)
  let text = raw.trim();
  const fence = text.match(/^```(?:[a-z]+)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) text = fence[1];

  const out: RawSection[] = [];
  // 헤더 인식: `^## ` (앞에 공백 허용)
  const lines = text.split(/\r?\n/);
  let cur: RawSection | null = null;
  let body: string[] = [];

  const flush = () => {
    if (cur) {
      cur.body = body.join("\n").trim();
      out.push(cur);
    }
    body = [];
  };

  const headerRe = /^\s*##\s+(.*)$/;
  for (const ln of lines) {
    const m = ln.match(headerRe);
    if (m) {
      flush();
      const header = m[1].trim();
      const kind = detectKind(header);
      cur = { kind, header, body: "" };
    } else if (cur) {
      body.push(ln);
    }
  }
  flush();
  return out;
}

function detectKind(header: string): RawSection["kind"] {
  const h = header.toUpperCase();
  if (h.startsWith("SUMMARY")) return "SUMMARY";
  if (h.startsWith("OUTPUT")) return "OUTPUT";
  if (h.startsWith("STEP")) return "STEP";
  if (h.startsWith("KPI")) return "KPI";
  if (h.startsWith("SAMPLE")) return "SAMPLE";
  if (h.startsWith("PITFALL")) return "PITFALL";
  if (h.startsWith("REFERENCE")) return "REFERENCE";
  return "UNKNOWN";
}

/**
 * Parse a STEP header like:
 *   "STEP 1: ICP 정의 | 담당: 대표 + PM | 예상: 3h"
 * Returns title + owner + hours.
 */
function parseStepHeader(header: string): {
  title: string;
  owner?: string;
  estimated_hours?: number;
} {
  // strip leading "STEP N:"
  const noPrefix = header.replace(/^STEP\s*\d*\s*[:\.]?\s*/i, "").trim();
  const parts = noPrefix.split("|").map((p) => p.trim());
  const title = parts[0] || "";
  let owner: string | undefined;
  let estimated_hours: number | undefined;
  for (const p of parts.slice(1)) {
    const ownerM = p.match(/^담당\s*[:：]\s*(.+)$/);
    if (ownerM) owner = ownerM[1].trim().slice(0, 40);
    const hourM = p.match(/(?:예상|estimated?)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*h/i);
    if (hourM) estimated_hours = Math.max(0, Math.min(200, parseFloat(hourM[1])));
  }
  return {
    title: title.slice(0, 80),
    owner,
    estimated_hours,
  };
}

/**
 * Parse a KPI section body like:
 *   목표: ≥40%
 *   측정: GA4에서 주간 측정
 * Returns threshold + method.
 */
function parseKpiBody(body: string): { threshold: string; method: string } {
  const lines = body.split(/\r?\n/);
  let threshold = "";
  let method = "";
  let bucket: "none" | "threshold" | "method" = "none";
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) continue;
    const tMatch = trimmed.match(/^(?:목표|target|threshold)\s*[:：]\s*(.+)$/i);
    if (tMatch) {
      threshold = tMatch[1].trim();
      bucket = "threshold";
      continue;
    }
    const mMatch = trimmed.match(/^(?:측정|measurement|method|수집)\s*[:：]\s*(.+)$/i);
    if (mMatch) {
      method = mMatch[1].trim();
      bucket = "method";
      continue;
    }
    // continuation line — append to current bucket
    if (bucket === "threshold") threshold += " " + trimmed;
    else if (bucket === "method") method += " " + trimmed;
  }
  return {
    threshold: threshold.slice(0, 200),
    method: method.slice(0, 320),
  };
}

function clean(s: string): string {
  return sanitizeMarkdown(s);
}
function cleanPlain(s: string): string {
  return sanitizePlain(s);
}

function parseMarkdown(raw: string): {
  summary: string;
  output: string;
  steps: PlaybookStep[];
  kpis: PlaybookKPI[];
  sample: string;
  pitfalls: string[];
  references: string[];
} {
  const sections = splitSections(raw);
  let summary = "";
  let output = "";
  let sample = "";
  const steps: PlaybookStep[] = [];
  const kpis: PlaybookKPI[] = [];
  const pitfalls: string[] = [];
  const references: string[] = [];

  for (const s of sections) {
    switch (s.kind) {
      case "SUMMARY":
        summary = clean(s.body).slice(0, 800);
        break;
      case "OUTPUT":
        output = clean(s.body).slice(0, 600);
        break;
      case "STEP": {
        const parsed = parseStepHeader(s.header);
        if (parsed.title && s.body) {
          steps.push({
            title: cleanPlain(parsed.title).slice(0, 80),
            detail: clean(s.body).slice(0, 1200),
            owner: parsed.owner ? cleanPlain(parsed.owner).slice(0, 40) : undefined,
            estimated_hours: parsed.estimated_hours,
          });
        }
        break;
      }
      case "KPI": {
        const name = cleanPlain(
          s.header.replace(/^KPI\s*[:：]?\s*/i, ""),
        ).slice(0, 80);
        const parsedKpi = parseKpiBody(s.body);
        const threshold = cleanPlain(parsedKpi.threshold).slice(0, 200);
        const method = cleanPlain(parsedKpi.method).slice(0, 320);
        if (name && threshold) kpis.push({ name, threshold, method });
        break;
      }
      case "SAMPLE":
        // SAMPLE 은 줄바꿈/들여쓰기를 그대로 보존 (사용자가 그대로 복사해서 씀)
        sample = sanitizePreservingIndent(s.body).slice(0, 4000);
        break;
      case "PITFALL":
        if (s.body.trim()) pitfalls.push(clean(s.body).slice(0, 280));
        break;
      case "REFERENCE":
        if (s.body.trim()) references.push(cleanPlain(s.body).slice(0, 240));
        break;
      default:
        break;
    }
  }

  return { summary, output, steps, kpis, sample, pitfalls, references };
}

export async function generatePlaybook(
  input: PlaybookInput,
): Promise<PlaybookOutput> {
  const model = "claude-haiku-4-5-20251001";
  const generated_at = new Date().toISOString();

  const userMessage = [
    `[업무 ID] ${input.task_id}`,
    `[업무 제목] ${input.title}`,
    `[왜 필요한가] ${input.why}`,
    `[팀] ${input.team}`,
    `[라이프사이클 단계] ${input.phase}`,
    input.funnel_stage ? `[고객여정 단계] ${input.funnel_stage}` : null,
    `[주기] ${input.cadence}`,
    `[티어] ${input.tier}`,
    input.domain ? `[도메인] ${input.domain}` : null,
    input.hint ? `[힌트] ${input.hint}` : null,
    input.ai_leverage ? `[AI 활용 메모] ${input.ai_leverage}` : null,
    "",
    "위 업무를 실행하는 직원이 바로 참고해서 액션할 수 있도록 풍부한 자료를 마크다운 섹션 형식으로 생성해주세요. (JSON 아님)",
  ]
    .filter(Boolean)
    .join("\n");

  // Anthropic prompt caching — system prompt이 모든 task에 공통이므로 ephemeral
  // cache로 표시. 첫 호출 이후 cached read (TTL 5분)는 ~85% 비용/지연 절감.
  // 134개 카드 bulk 생성 시 압도적인 처리량 향상.
  const resp = await anthropic().messages.create({
    model,
    max_tokens: 4500,
    temperature: 0.3,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = resp.content.reduce(
    (acc, b) => acc + (b.type === "text" ? b.text : ""),
    "",
  );

  const parsed = parseMarkdown(raw);

  // Fallbacks — 섹션이 비었을 때 최소한의 내용 보장
  const summary =
    parsed.summary ||
    `${input.title} — ${input.why}`.slice(0, 200);

  return {
    summary,
    output: parsed.output,
    steps: parsed.steps.slice(0, 8),
    kpis: parsed.kpis.slice(0, 6),
    sample: parsed.sample,
    pitfalls: parsed.pitfalls.slice(0, 6),
    references: parsed.references.slice(0, 5),
    model,
    generated_at,
  };
}

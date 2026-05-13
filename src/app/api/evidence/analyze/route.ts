/**
 * POST /api/evidence/analyze — 진단 evidence 입력을 Claude 가 분석.
 *
 * 입력: { sub_item_code, actual_value, notes, evidence_files[], selected_bucket }
 *
 * 처리:
 *   1. sub_item 정의 (질문·5단계 옵션·citation) 를 framework loader 에서 가져옴
 *   2. 사용자가 입력한 실측값·노트·파일 메타를 Claude 시스템 프롬프트에 주입
 *   3. JSON 응답 강제: { summary, suggested_bucket, confidence, flags }
 *   4. 이미지/PDF 파일은 URL 만 Claude 에 전달 (vision 첨부는 차후 phase)
 *
 * 반환: { ok, analysis: EvidenceAIAnalysis }
 *
 * 모델: Claude haiku 4.5 (저비용·빠른 분석)
 * Prompt cache: framework 전체가 아닌 sub_item 단일 정의만 시스템에 들어가므로 cache 효과 작음.
 *               대신 출력 schema 가 한국어 + 5필드로 짧아 토큰 비용 낮음.
 */

import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@/lib/anthropic";
import { loadFramework } from "@/lib/framework/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-haiku-4-5-20251001";

interface EvidenceFile {
  url: string;
  name: string;
  size: number;
  mime: string;
  uploaded_at: string;
}

interface AnalyzeRequest {
  sub_item_code: string;
  actual_value?: string;
  notes?: string;
  evidence_files?: EvidenceFile[];
  selected_bucket?: number | null;
}

interface EvidenceAIAnalysis {
  summary: string;
  suggested_bucket: number | null;
  confidence: number;
  flags: string[];
  analyzed_at: string;
  model: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: NextRequest) {
  let body: AnalyzeRequest;
  try {
    body = (await req.json()) as AnalyzeRequest;
  } catch {
    return bad("JSON body 파싱 실패");
  }

  if (!body.sub_item_code) return bad("sub_item_code 필요");

  const framework = loadFramework();
  let foundSub: ReturnType<typeof findSubItem> = null;
  foundSub = findSubItem(framework, body.sub_item_code);
  if (!foundSub) {
    return bad(`알 수 없는 sub_item_code: ${body.sub_item_code}`);
  }
  const { domain, sub } = foundSub;

  // 입력 요약
  const hasValue = !!body.actual_value?.trim();
  const hasNotes = !!body.notes?.trim();
  const fileCount = body.evidence_files?.length ?? 0;
  if (!hasValue && !hasNotes && fileCount === 0) {
    return bad("분석할 입력 없음 (값·노트·파일 중 최소 1개 필요)");
  }

  // Evidence options 텍스트 생성
  const optionsText = (sub.evidence.options ?? [])
    .map(
      (o) =>
        `  ${o.v}: ${o.label}`,
    )
    .join("\n");

  // 파일 메타 텍스트 (vision attach 는 차후 phase)
  const filesText =
    body.evidence_files && body.evidence_files.length > 0
      ? body.evidence_files
          .map(
            (f, i) =>
              `  ${i + 1}. ${f.name} (${f.mime}, ${(f.size / 1024).toFixed(0)}KB) - ${f.url}`,
          )
          .join("\n")
      : "(없음)";

  const userBucket =
    body.selected_bucket !== null && body.selected_bucket !== undefined
      ? body.selected_bucket
      : "(미선택)";

  const systemPrompt = `당신은 한국 영유아 EdTech 운영진을 돕는 진단 evidence 검증 분석가입니다.
운영진이 입력한 실측값·컨텍스트·증거 문서를 검토해 (a) 5단계 bucket 추론, (b) 1-3문장 한국어
요약, (c) 신뢰도와 (d) 의심 플래그를 산출합니다.

규칙:
- 측정값이 명확한 숫자/단위면 evidence options 기준으로 bucket 추론.
- 컨텍스트 노트만 있고 측정값이 없으면 bucket 은 null. 노트에서 인용 가능한 정보 추출.
- 파일이 있으면 파일명·확장자·크기로 종류 추정 (스크린샷·CSV·PDF). vision 첨부는 차후.
- 입력 정보가 모순되거나, 측정 표본이 너무 작거나, 시점이 90일 초과면 flags 에 추가.
- 한국어로 응답. 평가용이므로 가설/추측보다 입력된 사실 기반.

응답은 다음 JSON schema 만 출력 (markdown · 코드펜스 금지):
{
  "summary": "1-3문장 한국어 요약. 무엇이 입력됐고, 그 의미·시사점.",
  "suggested_bucket": 1|2|3|4|5|null,
  "confidence": 0.0-1.0,
  "flags": ["data_mismatch" | "small_sample" | "stale" | "no_proof" | "vague_text" | "unit_unclear"]
}`;

  const userPrompt = `# 도메인
${domain.code} · ${domain.name_ko}

# Sub-item (${sub.code})
질문 (belief): ${sub.belief.q}
질문 (evidence): ${sub.evidence.q}
Evidence options:
${optionsText || "  (옵션 정의 없음)"}
근거 출처: ${sub.citation ?? "(없음)"}

# 운영진 입력
사용자가 선택한 5단계 bucket: ${userBucket}
실제 측정값: ${hasValue ? body.actual_value : "(입력 없음)"}
컨텍스트 노트: ${hasNotes ? body.notes : "(입력 없음)"}
첨부 문서 ${fileCount}건:
${filesText}

# 작업
위 입력을 검토해 evidence 의 진위·품질을 분석해 JSON 만 출력하세요.`;

  let raw = "";
  try {
    const resp = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 600,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    raw = resp.content
      .flatMap((b) =>
        b.type === "text" && typeof (b as { text?: unknown }).text === "string"
          ? [(b as { text: string }).text]
          : [],
      )
      .join("\n")
      .trim();
  } catch (e) {
    return bad(
      `Claude 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
      500,
    );
  }

  // JSON 파싱 — 코드펜스 제거 후 파싱
  const parsed = parseAnalysisJson(raw);
  if (!parsed) {
    return bad(`AI 응답 파싱 실패: ${raw.slice(0, 200)}`, 500);
  }

  const analysis: EvidenceAIAnalysis = {
    summary: parsed.summary,
    suggested_bucket: parsed.suggested_bucket,
    confidence: parsed.confidence,
    flags: parsed.flags,
    analyzed_at: new Date().toISOString(),
    model: MODEL,
  };

  return NextResponse.json({ ok: true, analysis });
}

// ============================================================
// Helpers
// ============================================================

function findSubItem(
  framework: ReturnType<typeof loadFramework>,
  code: string,
) {
  for (const domain of framework.domains) {
    for (const group of domain.groups) {
      for (const sub of group.sub_items) {
        if (sub.code === code) return { domain, group, sub };
      }
    }
  }
  return null;
}

interface ParsedAnalysis {
  summary: string;
  suggested_bucket: number | null;
  confidence: number;
  flags: string[];
}

function parseAnalysisJson(raw: string): ParsedAnalysis | null {
  let text = raw.trim();
  // 코드펜스 제거
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  // 첫 { ... } 추출
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as Record<string, unknown>;
    const summary = typeof obj.summary === "string" ? obj.summary : "";
    if (!summary) return null;
    let bucket: number | null = null;
    if (
      typeof obj.suggested_bucket === "number" &&
      obj.suggested_bucket >= 1 &&
      obj.suggested_bucket <= 5
    ) {
      bucket = Math.round(obj.suggested_bucket);
    }
    const confidence =
      typeof obj.confidence === "number"
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0.5;
    const flags = Array.isArray(obj.flags)
      ? obj.flags.filter((f): f is string => typeof f === "string").slice(0, 5)
      : [];
    return { summary, suggested_bucket: bucket, confidence, flags };
  } catch {
    return null;
  }
}

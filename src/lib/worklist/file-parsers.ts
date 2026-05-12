/**
 * Client-side file parsers — CSV/XLSX/DOCX/TXT/MD → 텍스트 직렬화.
 *
 * 서버 라우트는 텍스트만 받기 때문에 (Vercel 함수 body 4.5MB 제한 회피 + Supabase
 * Storage 권한 불필요) 클라이언트에서 1차 파싱 후 헤더 + 상위 N행 또는 본문
 * 텍스트를 압축해 AI에 전달한다.
 *
 * 지원 형식:
 * - CSV         : papaparse (5KB gzipped, eager)
 * - XLSX / XLS  : SheetJS CE (~600KB, dynamic import)
 * - DOCX        : mammoth (~200KB, dynamic import) — Word 문서 텍스트 추출
 * - TXT / MD    : 그대로 읽기
 */

import Papa from "papaparse";

const MAX_PREVIEW_ROWS = 200;
const MAX_TEXT_LEN = 50_000;

export type FileKind = "csv" | "xlsx" | "docx" | "text";

export interface FileParseResult {
  filename: string;
  kind: FileKind;
  rows_total: number;
  rows_used: number;
  text: string;
  truncated: boolean;
}

/** Serialize an array-of-arrays (headers + rows) to a compact text block. */
function tabularize(rows: string[][], filename: string, kind: FileKind): {
  text: string;
  rows_used: number;
  truncated: boolean;
} {
  if (rows.length === 0) {
    return {
      text: `# ${filename} (${kind})\n(빈 파일)\n`,
      rows_used: 0,
      truncated: false,
    };
  }
  const header = rows[0];
  const dataRows = rows.slice(1, MAX_PREVIEW_ROWS + 1);
  const lines: string[] = [
    `# ${filename} (${kind})`,
    `# rows_total=${rows.length - 1}, rows_shown=${dataRows.length}`,
    header.join("\t"),
    ...dataRows.map((r) => r.join("\t")),
  ];
  let text = lines.join("\n");
  let truncated = dataRows.length < rows.length - 1;
  if (text.length > MAX_TEXT_LEN) {
    text = text.slice(0, MAX_TEXT_LEN) + "\n... (잘림)";
    truncated = true;
  }
  return { text, rows_used: dataRows.length, truncated };
}

export async function parseCsv(file: File): Promise<FileParseResult> {
  const parsed = await new Promise<Papa.ParseResult<string[]>>(
    (resolve, reject) => {
      Papa.parse<string[]>(file, {
        skipEmptyLines: true,
        complete: (res) => resolve(res),
        error: (err: Error) => reject(err),
      });
    },
  );
  const rows = parsed.data
    .filter((r): r is string[] => Array.isArray(r))
    .map((r) => r.map((c) => (c == null ? "" : String(c))));
  const { text, rows_used, truncated } = tabularize(rows, file.name, "csv");
  return {
    filename: file.name,
    kind: "csv",
    rows_total: Math.max(0, rows.length - 1),
    rows_used,
    text,
    truncated,
  };
}

export async function parseXlsx(file: File): Promise<FileParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return {
      filename: file.name,
      kind: "xlsx",
      rows_total: 0,
      rows_used: 0,
      text: `# ${file.name} (xlsx)\n(시트 없음)\n`,
      truncated: false,
    };
  }
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  const rows = raw.map((r) =>
    (Array.isArray(r) ? r : []).map((c) => (c == null ? "" : String(c))),
  );
  const { text, rows_used, truncated } = tabularize(rows, file.name, "xlsx");
  return {
    filename: file.name,
    kind: "xlsx",
    rows_total: Math.max(0, rows.length - 1),
    rows_used,
    text: `# 시트: ${sheetName}\n${text}`,
    truncated,
  };
}

export async function parseDocx(file: File): Promise<FileParseResult> {
  const mammoth = await import("mammoth");
  const buf = await file.arrayBuffer();
  // 브라우저 빌드는 arrayBuffer 옵션 받아서 raw text 추출
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  const raw = res.value ?? "";
  let text = `# ${file.name} (docx)\n${raw}`;
  let truncated = false;
  if (text.length > MAX_TEXT_LEN) {
    text = text.slice(0, MAX_TEXT_LEN) + "\n... (잘림)";
    truncated = true;
  }
  // rows_total/rows_used는 문단 수로 근사
  const paragraphs = raw.split(/\n+/).filter((l) => l.trim().length > 0);
  return {
    filename: file.name,
    kind: "docx",
    rows_total: paragraphs.length,
    rows_used: paragraphs.length,
    text,
    truncated,
  };
}

export async function parseText(file: File): Promise<FileParseResult> {
  const raw = await file.text();
  let text = `# ${file.name}\n${raw}`;
  let truncated = false;
  if (text.length > MAX_TEXT_LEN) {
    text = text.slice(0, MAX_TEXT_LEN) + "\n... (잘림)";
    truncated = true;
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return {
    filename: file.name,
    kind: "text",
    rows_total: lines.length,
    rows_used: lines.length,
    text,
    truncated,
  };
}

/** Accept attribute string for <input type="file"> — all supported extensions. */
export const FILE_ACCEPT =
  ".csv,.xlsx,.xls,.docx,.txt,.md,text/csv,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Human label for kind — for UI. */
export const KIND_LABEL: Record<FileKind, string> = {
  csv: "CSV 표",
  xlsx: "Excel 시트",
  docx: "Word 문서",
  text: "텍스트",
};

/** Dispatch a File to the right parser by extension. Returns text+meta. */
export async function parseFile(file: File): Promise<FileParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") return parseCsv(file);
  if (ext === "xlsx" || ext === "xls") return parseXlsx(file);
  if (ext === "docx") return parseDocx(file);
  if (ext === "txt" || ext === "md" || ext === "markdown") return parseText(file);
  if (ext === "doc") {
    throw new Error(
      ".doc (구형 Word 바이너리) 는 지원되지 않습니다. Word에서 .docx 로 다시 저장해주세요.",
    );
  }
  if (ext === "pdf") {
    throw new Error(
      "PDF 파싱은 준비 중입니다. 본문 텍스트를 복사해서 [텍스트 붙여넣기] 모드에 입력해주세요.",
    );
  }
  throw new Error(
    `지원하지 않는 파일 형식: .${ext ?? "?"} (.csv / .xlsx / .docx / .txt / .md 만 허용)`,
  );
}

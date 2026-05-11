/**
 * Client-side file parsers — CSV/XLSX → 텍스트 직렬화.
 *
 * 서버 라우트는 텍스트만 받기 때문에 (Vercel 함수 body 4.5MB 제한 회피 + Supabase
 * Storage 권한 불필요) 클라이언트에서 1차 파싱 후 헤더 + 상위 N행을 압축한
 * 텍스트로 변환해 AI에 전달한다.
 *
 * - papaparse: CSV (5KB gzipped, eager)
 * - xlsx (SheetJS CE): XLSX (~600KB minified, dynamic import로 lazy load)
 */

import Papa from "papaparse";

const MAX_PREVIEW_ROWS = 200;
const MAX_TEXT_LEN = 50_000;

export interface FileParseResult {
  filename: string;
  kind: "csv" | "xlsx";
  rows_total: number;
  rows_used: number;
  text: string;
  truncated: boolean;
}

/** Serialize an array-of-arrays (headers + rows) to a compact text block. */
function tabularize(rows: string[][], filename: string, kind: "csv" | "xlsx"): {
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

/** Dispatch a File to the right parser by extension. Returns text+meta. */
export async function parseFile(file: File): Promise<FileParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") return parseCsv(file);
  if (ext === "xlsx" || ext === "xls") return parseXlsx(file);
  throw new Error(`지원하지 않는 파일 형식: .${ext ?? "?"} (.csv / .xlsx 만 허용)`);
}

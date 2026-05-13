/**
 * POST /api/evidence/upload — 진단 evidence 파일 업로드
 *
 * 흐름:
 *   1. 클라이언트가 FormData(workspace, sub_item_code, file) 로 POST
 *   2. 서버 측 검증 (MIME, 크기, workspace pattern)
 *   3. Supabase Storage 'diag-evidence' 버킷에 업로드
 *      경로: {workspace}/{sub_item_code}/{timestamp}-{filename}
 *   4. public URL 반환 (RLS 는 workspace 단위 anonymous, 추후 강화 예정)
 *
 * 반환:
 *   { ok: true, file: { url, name, size, mime, uploaded_at } }
 *   { ok: false, message }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "diag-evidence";
const WS_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
const SUB_PATTERN = /^[A-Z][0-9]+\.[A-Z0-9.]+$/;
const ACCEPT_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MAX_BYTES = 10 * 1024 * 1024;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return bad(`잘못된 FormData: ${e instanceof Error ? e.message : String(e)}`);
  }

  const workspace = String(form.get("workspace") ?? "");
  const subItemCode = String(form.get("sub_item_code") ?? "");
  const file = form.get("file");

  if (!WS_PATTERN.test(workspace)) return bad("invalid workspace");
  if (!SUB_PATTERN.test(subItemCode)) return bad("invalid sub_item_code");
  if (!(file instanceof File)) return bad("file 필드 없음");
  if (!ACCEPT_MIME.has(file.type)) {
    return bad(`지원하지 않는 파일 형식: ${file.type || "unknown"}`);
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return bad(`파일 크기 범위 초과 (${file.size} bytes, 최대 ${MAX_BYTES})`);
  }

  // 파일명 sanitize — 경로 traversal 방지 + 한글 보존
  const safeName = file.name
    .replace(/[\\/]/g, "_")
    .replace(/\.\.+/g, "_")
    .slice(0, 200);
  const ts = Date.now();
  const path = `${workspace}/${subItemCode}/${ts}-${safeName}`;

  const sb = supabaseAdmin();

  // 버킷이 없으면 생성 (idempotent)
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    const exists = (buckets ?? []).some((b) => b.name === BUCKET);
    if (!exists) {
      const { error: createErr } = await sb.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: MAX_BYTES,
      });
      if (createErr && !/already exists/i.test(createErr.message)) {
        return bad(`bucket create 실패: ${createErr.message}`, 500);
      }
    }
  } catch (e) {
    // bucket listing 실패해도 upload 시도는 진행 (생성된 버킷일 수 있음)
    console.warn(
      "[evidence/upload] bucket list failed:",
      e instanceof Error ? e.message : e,
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await sb.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadErr) {
    return bad(`업로드 실패: ${uploadErr.message}`, 500);
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    return bad("public URL 산출 실패", 500);
  }

  return NextResponse.json({
    ok: true,
    file: {
      url: pub.publicUrl,
      name: file.name,
      size: file.size,
      mime: file.type,
      uploaded_at: new Date(ts).toISOString(),
    },
  });
}

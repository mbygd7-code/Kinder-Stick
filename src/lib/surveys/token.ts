/**
 * Survey share-token 생성.
 *
 * 16-byte 랜덤 → base64url → 약 22 자.
 * 충돌 가능성: 2^128 = 약 3.4 × 10^38. 워크스페이스당 4분기 × 2 종 = 8개라면
 * 절대 충돌 안 함.
 */

import crypto from "node:crypto";

export function generateShareToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/** 응답자 IP + UA 를 해시로 변환 (개인정보 저장 X, 스팸 방지용). */
export function hashClient(ip: string, ua: string): {
  ip_hash: string;
  ua_hash: string;
} {
  return {
    ip_hash: crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32),
    ua_hash: crypto.createHash("sha256").update(ua).digest("hex").slice(0, 32),
  };
}

/** 토큰 형식 검증 (base64url 22자 내외). */
export function isValidToken(t: unknown): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{16,32}$/.test(t);
}

/**
 * PIN auth core — 자체 회원가입/로그인.
 *
 * 사용:
 *   - hashPin(pin)  → "salt:hash" 형태로 DB 저장
 *   - verifyPin(pin, stored) → boolean
 *   - signSession(payload) → 쿠키에 들어갈 서명 토큰
 *   - verifySession(token) → payload | null
 *
 * 보안 요약:
 *   - PIN 은 4자리 숫자(쉽게 만든다는 요구) → 무차별 대입 방지를 위해
 *     실패횟수·잠금시간을 DB(kso_profiles.failed_attempts/locked_until)에 기록
 *   - 비밀키는 env KSO_AUTH_SECRET (없으면 NEXT_PUBLIC_SUPABASE_ANON_KEY 폴백)
 *   - HMAC-SHA256 으로 payload 서명, 만료 timestamp 포함
 */

import crypto from "node:crypto";

const PIN_PATTERN = /^\d{4}$/;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 일

function authSecret(): string {
  return (
    process.env.KSO_AUTH_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "kso-dev-fallback-secret-not-for-prod"
  );
}

/** 4자리 숫자 PIN 검증. */
export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** scrypt 로 PIN 해시. 반환: "salt(hex):hash(hex)" */
export function hashPin(pin: string): string {
  if (!isValidPin(pin)) throw new Error("PIN은 4자리 숫자여야 합니다");
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** stored 형식: "salt(hex):hash(hex)" */
export function verifyPin(pin: string, stored: string): boolean {
  if (!isValidPin(pin)) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(pin, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export interface SessionPayload {
  uid: string; // kso_profiles.id
  email: string;
  role: "admin" | "member";
  team: string | null;
  exp: number; // unix seconds
}

/** payload → base64url(JSON).base64url(sig) */
export function signSession(payload: Omit<SessionPayload, "exp">): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const fullPayload: SessionPayload = { ...payload, exp };
  const body = base64url(JSON.stringify(fullPayload));
  const sig = base64url(
    crypto.createHmac("sha256", authSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = base64url(
    crypto.createHmac("sha256", authSecret()).update(body).digest(),
  );
  try {
    // timing-safe 비교
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(base64urlDecode(body)) as SessionPayload;
    if (typeof payload.exp !== "number") return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function base64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b, "base64").toString("utf8");
}

export const SESSION_COOKIE = "kso_session";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

// ── 팀 enum (catalog Team 과 동일) ──
export const TEAMS = [
  "director",
  "planning",
  "design",
  "engineering",
  "operations",
  "marketing",
] as const;
export type Team = (typeof TEAMS)[number];

export const TEAM_LABEL: Record<Team, string> = {
  director: "Director · 대표",
  planning: "기획팀",
  design: "디자인팀",
  engineering: "개발팀",
  operations: "운영팀",
  marketing: "마케팅팀",
};

export function isValidTeam(t: unknown): t is Team {
  return typeof t === "string" && (TEAMS as readonly string[]).includes(t);
}

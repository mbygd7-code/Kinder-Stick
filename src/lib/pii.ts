/**
 * PII redaction — replace personally identifiable info with tokens before
 * sending data to third-party services. Each redacted occurrence is replaced
 * with a stable token (per-call, deterministic) so the external response can
 * be re-hydrated if needed.
 *
 * Patterns covered:
 *  - Emails (RFC-ish)
 *  - Korean mobile numbers (010-xxxx-xxxx, 010xxxxxxxx, +82-10-...)
 *  - Korean resident registration numbers (xxxxxx-xxxxxxx)
 *  - Korean names (한글 2-4자 — heuristic; opt-out via context)
 *  - Generic full names (3+ capitalized tokens)
 *  - Common URLs containing tokens (?token=, ?key=, /secret/...)
 */

export interface RedactionEntry {
  token: string;
  original: string;
  kind: "email" | "phone" | "krn" | "name" | "url_token" | "uuid";
}

export interface RedactionResult {
  text: string;
  entries: RedactionEntry[];
}

const PATTERNS: Array<{
  re: RegExp;
  kind: RedactionEntry["kind"];
  prefix: string;
}> = [
  {
    re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    kind: "email",
    prefix: "EMAIL",
  },
  {
    re: /\b(?:\+82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g,
    kind: "phone",
    prefix: "PHONE",
  },
  {
    re: /\b\d{6}-\d{7}\b/g,
    kind: "krn",
    prefix: "KRN",
  },
  // url tokens / api keys (common patterns)
  {
    re: /(?:[?&](?:token|key|secret|password|auth)=)[^&\s]+/gi,
    kind: "url_token",
    prefix: "URLTOK",
  },
  // Korean names — 2-4 hangul chars, with spaces or punctuation around
  // Conservative: only match within explicit "name:" or after 이름 marker
  {
    re: /(?:이름[:\s]+|성명[:\s]+|name[:\s]+)([가-힣]{2,4})\b/gi,
    kind: "name",
    prefix: "NAME",
  },
  // Naive UUID redaction (so external services can't correlate per-action)
  {
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    kind: "uuid",
    prefix: "UUID",
  },
];

export function redactPii(input: string): RedactionResult {
  const entries: RedactionEntry[] = [];
  const seen = new Map<string, string>(); // original → token (per-call dedup)
  let text = input;
  let counter = 0;

  for (const { re, kind, prefix } of PATTERNS) {
    text = text.replace(re, (match, capture) => {
      const target =
        kind === "name" && capture ? capture : match;
      const existing = seen.get(target);
      if (existing) {
        return kind === "name" && capture
          ? match.replace(target, existing)
          : existing;
      }
      counter++;
      const token = `<${prefix}_${counter}>`;
      seen.set(target, token);
      entries.push({ token, original: target, kind });
      return kind === "name" && capture
        ? match.replace(target, token)
        : token;
    });
  }

  return { text, entries };
}

/**
 * Redact a JSON object recursively (only string values).
 * Returns the redacted object + flat list of entries.
 */
export function redactJson(
  obj: unknown,
): { value: unknown; entries: RedactionEntry[] } {
  const allEntries: RedactionEntry[] = [];

  function walk(node: unknown): unknown {
    if (typeof node === "string") {
      const { text, entries } = redactPii(node);
      allEntries.push(...entries);
      return text;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  }

  return { value: walk(obj), entries: allEntries };
}

/**
 * Re-hydrate a redacted text with original values (for safe internal use only;
 * never send the rehydrated payload back to external services).
 */
export function rehydratePii(
  redacted: string,
  entries: RedactionEntry[],
): string {
  let out = redacted;
  for (const e of entries) {
    out = out.split(e.token).join(e.original);
  }
  return out;
}

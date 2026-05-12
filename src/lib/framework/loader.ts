/**
 * Framework loader — reads question_bank.yaml + playbooks.yaml from
 * the workspace root (D:/claude_project/Milo/framework/) at request time.
 *
 * Server-side only. Cached per-request via React.cache.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { parse } from "yaml";

// Resolve framework dir — prefer in-repo (kinder-stick-os/framework) and
// fall back to parent (workspace-root/framework) for legacy local layout.
const FRAMEWORK_DIR = (() => {
  const inRepo = join(process.cwd(), "framework");
  const parent = join(process.cwd(), "..", "framework");
  try {
    require("node:fs").statSync(join(inRepo, "question_bank.yaml"));
    return inRepo;
  } catch {
    return parent;
  }
})();

// ============================================================
// Types
// ============================================================

export type Tier = "critical" | "important" | "supporting";
export type Cadence =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semi_annual";

export interface BeliefDef {
  q: string;
  anchors: [string, string, string, string, string];
  help?: string;
}

export interface EvidenceOption {
  v: number;
  label: string;
}

export interface EvidenceDef {
  q: string;
  type: "choice" | "numeric_kpi";
  options?: EvidenceOption[];
  kpi_source?: string;
  refresh_period_days: number;
}

export interface SubItem {
  code: string;
  domain: string; // "A2"
  group: string; // "A2.SE"
  tier: Tier;
  weight_within_group: number;
  belief: BeliefDef;
  evidence: EvidenceDef;
  citation: string;
  failure_trigger: string;
  cadence: Cadence;
  data_quality_required?: 1 | 2 | 3;
  reverse_scoring?: boolean;
}

export interface Group {
  code: string;
  name: string;
  sub_items: SubItem[];
}

export interface Domain {
  code: string;
  name_ko: string;
  name_en: string;
  tier: Tier;
  weight: number;
  owner_role: string[];
  framework: string;
  thresholds: { red: number; yellow: number; green: number };
  notes?: string;
  groups: Group[];
}

export interface PriorTable {
  closed_beta: { failure_6m: number; failure_12m: number };
  open_beta: { failure_6m: number; failure_12m: number };
  ga_early: { failure_6m: number; failure_12m: number };
  ga_growth: { failure_6m: number; failure_12m: number };
  ga_scale: { failure_6m: number; failure_12m: number };
}

export interface CriticalCapRaw {
  sub_item: string;
  condition: string;
  min_p_6m: number;
}

export interface FrameworkConfig {
  version: string;
  updated: string;
  locale: string;
  priors: PriorTable;
  likelihood_ratios: Record<string, number>;
  critical_caps: CriticalCapRaw[];
  domains: Domain[];
}

export interface Playbook {
  id: string;
  domain: string;
  title: string;
  trigger: { primary: string; secondary?: string[] };
  diagnostic_q: string;
  smart_actions: Array<{
    owner: string;
    deadline_days: number;
    action: string;
  }>;
  verify: { metric: string; after_days: number };
  cite: string;
  external_handoff?: { when: string; domain: string; target: string };
}

export interface PlaybooksFile {
  version: string;
  updated: string;
  playbooks: Playbook[];
}

// ============================================================
// Loaders (cached per request)
// ============================================================

const DEFAULT_LIKERT_ANCHORS: [string, string, string, string, string] = [
  "전혀 아니다",
  "다소 아니다",
  "보통",
  "다소 그렇다",
  "매우 그렇다",
];

export const loadFramework = cache((): FrameworkConfig => {
  const path = join(FRAMEWORK_DIR, "question_bank.yaml");
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw) as Omit<FrameworkConfig, "domains"> & {
    domains: Array<
      Omit<Domain, "groups"> & {
        groups: Array<{
          code: string;
          name: string;
          sub_items?: Array<
            Omit<SubItem, "domain" | "group" | "belief"> & {
              domain?: string;
              group?: string;
              belief: { q: string; anchors?: string[]; help?: string };
            }
          >;
        }>;
      }
    >;
  };

  const domains: Domain[] = parsed.domains.map((d) => ({
    ...d,
    groups: d.groups.map((g) => ({
      code: g.code,
      name: g.name,
      sub_items: (g.sub_items ?? []).map((s) => ({
        ...s,
        domain: d.code,
        group: g.code,
        data_quality_required: s.data_quality_required ?? 1,
        belief: {
          q: s.belief.q,
          help: s.belief.help,
          anchors:
            s.belief.anchors && s.belief.anchors.length === 5
              ? (s.belief.anchors as [string, string, string, string, string])
              : DEFAULT_LIKERT_ANCHORS,
        },
      })) as SubItem[],
    })),
  }));

  return {
    version: parsed.version,
    updated: parsed.updated,
    locale: parsed.locale,
    priors: parsed.priors,
    likelihood_ratios: parsed.likelihood_ratios,
    critical_caps: parsed.critical_caps,
    domains,
  };
});

export const loadPlaybooks = cache((): PlaybooksFile => {
  const path = join(FRAMEWORK_DIR, "playbooks.yaml");
  const raw = readFileSync(path, "utf-8");
  return parse(raw) as PlaybooksFile;
});

// ============================================================
// Convenience selectors
// ============================================================

export function getAllSubItems(framework: FrameworkConfig): SubItem[] {
  return framework.domains.flatMap((d) =>
    d.groups.flatMap((g) => g.sub_items),
  );
}

export function getDomain(
  framework: FrameworkConfig,
  code: string,
): Domain | undefined {
  return framework.domains.find((d) => d.code === code);
}

export function getSubItem(
  framework: FrameworkConfig,
  code: string,
): SubItem | undefined {
  for (const d of framework.domains) {
    for (const g of d.groups) {
      const s = g.sub_items.find((s) => s.code === code);
      if (s) return s;
    }
  }
  return undefined;
}

export function countByTier(items: { tier: Tier }[]): {
  critical: number;
  important: number;
  supporting: number;
} {
  return items.reduce(
    (acc, x) => {
      acc[x.tier]++;
      return acc;
    },
    { critical: 0, important: 0, supporting: 0 },
  );
}

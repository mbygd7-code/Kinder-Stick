/**
 * Dispatch orchestrator — when an action is accepted, fire-and-forget to
 * configured integrations and return aggregated results.
 */

import {
  dispatchToNotion,
  notionConfigured,
  type NotionDispatchInput,
} from "./notion";
import { dispatchToSlack, slackConfigured } from "./slack";
import type { DispatchResult } from "./notion";

export interface DispatchSummary {
  notion: DispatchResult & { configured: boolean };
  slack: DispatchResult & { configured: boolean };
  any_real_dispatch: boolean;
}

export async function dispatchAction(
  input: NotionDispatchInput & { finding_excerpt?: string | null },
): Promise<DispatchSummary> {
  const [notionRes, slackRes] = await Promise.all([
    dispatchToNotion(input),
    dispatchToSlack(input),
  ]);

  return {
    notion: { ...notionRes, configured: notionConfigured() },
    slack: { ...slackRes, configured: slackConfigured() },
    any_real_dispatch:
      (!notionRes.mock && notionRes.ok) || (!slackRes.mock && slackRes.ok),
  };
}

export function integrationsStatus(): {
  notion: { configured: boolean };
  slack: { configured: boolean };
} {
  return {
    notion: { configured: notionConfigured() },
    slack: { configured: slackConfigured() },
  };
}

/**
 * Slack integration — post coaching action as a message via incoming webhook.
 *
 * Configuration via env:
 *   SLACK_WEBHOOK_URL    (https://hooks.slack.com/services/...)
 *
 * Mock mode when env unset.
 */

import type { DispatchResult } from "./notion";

export interface SlackDispatchInput {
  action_id: string;
  workspace_id: string;
  title: string;
  owner_role: string | null;
  deadline: string | null;
  status: string;
  domain_code?: string | null;
  verification_metric?: string | null;
  finding_excerpt?: string | null;
}

export async function dispatchToSlack(
  input: SlackDispatchInput,
): Promise<DispatchResult> {
  const url = process.env.SLACK_WEBHOOK_URL;
  const dispatched_at = new Date().toISOString();

  if (!url) {
    return {
      ok: true,
      mock: true,
      external_id: `mock-slack-${input.action_id.slice(0, 8)}`,
      dispatched_at,
    };
  }

  const deadlineLine = input.deadline
    ? `*Deadline*: ${input.deadline.slice(0, 10)}`
    : "_no deadline_";
  const ownerLine = input.owner_role
    ? `*Owner*: ${input.owner_role}`
    : "_unassigned_";
  const verifyLine = input.verification_metric
    ? `*Verify*: ${input.verification_metric.slice(0, 200)}`
    : "";
  const domainLine = input.domain_code
    ? `*Domain*: \`${input.domain_code}\``
    : "";

  const body = {
    text: `🤖 New action accepted: ${input.title.slice(0, 80)}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🤖 Coach action · ${input.workspace_id}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${input.title.slice(0, 1500)}*`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: [domainLine, ownerLine, deadlineLine]
              .filter(Boolean)
              .join("  ·  "),
          },
        ],
      },
      ...(verifyLine
        ? [
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: verifyLine }],
            },
          ]
        : []),
      ...(input.finding_excerpt
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `> ${input.finding_excerpt.slice(0, 500)}`,
              },
            },
          ]
        : []),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Action ID \`${input.action_id.slice(0, 8)}\` · status \`${input.status}\``,
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        mock: false,
        error: `slack ${res.status}: ${text.slice(0, 200)}`,
        dispatched_at,
      };
    }
    return {
      ok: true,
      mock: false,
      external_id: `slack-${input.action_id.slice(0, 8)}`,
      dispatched_at,
    };
  } catch (e) {
    return {
      ok: false,
      mock: false,
      error: e instanceof Error ? e.message : String(e),
      dispatched_at,
    };
  }
}

export function slackConfigured(): boolean {
  return !!process.env.SLACK_WEBHOOK_URL;
}

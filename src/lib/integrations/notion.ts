/**
 * Notion integration — POST coaching action as a database row.
 *
 * Configuration via env:
 *   NOTION_TOKEN          (Bearer secret_...)
 *   NOTION_DATABASE_ID    (target database UUID)
 *
 * If either env is missing, dispatch returns mock success so demo flow works
 * without external setup. Real dispatch requires a Notion database with at
 * least these columns:
 *   Title (title)
 *   Status (select: accepted, in_progress, completed, verified, failed, abandoned)
 *   Owner (rich_text)
 *   Deadline (date)
 *   Source (rich_text)         — workspace_id
 *   Action ID (rich_text)
 */

export interface NotionDispatchInput {
  action_id: string;
  workspace_id: string;
  title: string;
  owner_role: string | null;
  deadline: string | null;
  status: string;
  verification_metric?: string | null;
  domain_code?: string | null;
}

export interface DispatchResult {
  ok: boolean;
  mock: boolean;
  external_id?: string;
  external_url?: string;
  error?: string;
  dispatched_at: string;
}

const NOTION_API = "https://api.notion.com/v1/pages";
const NOTION_VERSION = "2022-06-28";

export async function dispatchToNotion(
  input: NotionDispatchInput,
): Promise<DispatchResult> {
  const token = process.env.NOTION_TOKEN;
  const database_id = process.env.NOTION_DATABASE_ID;
  const dispatched_at = new Date().toISOString();

  if (!token || !database_id) {
    return {
      ok: true,
      mock: true,
      external_id: `mock-notion-${input.action_id.slice(0, 8)}`,
      external_url: `https://notion.so/mock/${input.action_id.slice(0, 8)}`,
      dispatched_at,
    };
  }

  const properties: Record<string, unknown> = {
    Title: {
      title: [{ text: { content: input.title.slice(0, 2000) } }],
    },
    Status: { select: { name: input.status } },
    "Action ID": {
      rich_text: [{ text: { content: input.action_id } }],
    },
    Source: {
      rich_text: [{ text: { content: input.workspace_id } }],
    },
  };
  if (input.owner_role) {
    properties.Owner = {
      rich_text: [{ text: { content: input.owner_role } }],
    };
  }
  if (input.deadline) {
    properties.Deadline = {
      date: { start: input.deadline.slice(0, 10) },
    };
  }
  if (input.domain_code) {
    properties.Domain = {
      rich_text: [{ text: { content: input.domain_code } }],
    };
  }
  if (input.verification_metric) {
    properties["Verify Metric"] = {
      rich_text: [
        { text: { content: input.verification_metric.slice(0, 1900) } },
      ],
    };
  }

  try {
    const res = await fetch(NOTION_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id },
        properties,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        mock: false,
        error: `notion ${res.status}: ${text.slice(0, 200)}`,
        dispatched_at,
      };
    }
    const json = (await res.json()) as { id?: string; url?: string };
    return {
      ok: true,
      mock: false,
      external_id: json.id,
      external_url: json.url,
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

export function notionConfigured(): boolean {
  return !!(process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID);
}

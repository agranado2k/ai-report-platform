// MCP tool definitions (ADR-0051). Each tool is a thin wrapper over the ApiClient:
// it calls `/api/v1` and maps the result into an MCP `CallToolResult`. Tools are
// intent-level + domain-prefixed; read tools carry read-only annotations. Upstream
// RFC-9457 problems become `isError` results (with secrets left out — the API's
// problem bodies are already safe, machine-readable, ADR-0040) so the model can
// react instead of the call throwing a protocol error.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ApiClient, ApiResult, Problem } from "./client";

/** Annotation set for non-mutating tools (SDK defaults assume destructive, ADR-0051). */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function okResult(data: unknown): CallToolResult {
  const content = [{ type: "text" as const, text: JSON.stringify(data, null, 2) }];
  // structuredContent is an object map per the MCP spec — only attach it for a
  // plain object (not an array, not a primitive); the text channel always carries
  // the full payload regardless.
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? { content, structuredContent: data as Record<string, unknown> }
    : { content };
}

export function problemResult(problem: Problem): CallToolResult {
  const code = problem.code ? ` (${problem.code})` : "";
  const detail = problem.detail ? ` — ${problem.detail}` : "";
  return {
    content: [{ type: "text", text: `Error ${problem.status}${code}: ${problem.title}${detail}` }],
    isError: true,
  };
}

export function toToolResult(result: ApiResult<unknown>): CallToolResult {
  return result.ok ? okResult(result.data) : problemResult(result.problem);
}

/** Register the Phase-1 read tools on `server`, backed by `client`. */
export function registerReadTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "reports_search",
    {
      title: "Search reports",
      description:
        "Search your reports by title/slug text. Returns a paginated list; each item has " +
        "slug, title, is_published, and folder_id. Read-only — use it to find a report " +
        "before you update, move, or delete it. Omit `q` to list everything.",
      inputSchema: {
        q: z.string().optional().describe("Free-text match on title/slug. Omit to list all."),
        folder_id: z.string().optional().describe("Restrict results to this folder id."),
        page: z.number().int().positive().optional().describe("1-based page number (default 1)."),
        page_size: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Items per page (default 20). The API clamps very large values."),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      toToolResult(
        await client.searchReports({
          q: args.q,
          folderId: args.folder_id,
          page: args.page,
          pageSize: args.page_size,
        }),
      ),
  );

  server.registerTool(
    "folders_list",
    {
      title: "List folders",
      description:
        "List your folder tree (id, name, parent id). Read-only. Use a folder id with " +
        "reports_search to scope a search, or when deciding where to organize a report.",
      annotations: READ_ONLY,
    },
    async () => toToolResult(await client.listFolders()),
  );
}

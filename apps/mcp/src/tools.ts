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

// Tool annotations (SDK defaults assume destructive + open-world, ADR-0051, so we
// set them deliberately). None of these tools reach an "open world" — they talk
// only to our own API — hence openWorldHint:false throughout.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
/** Rename/move: mutate, non-destructive, safe to repeat. */
const MUTATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
/** Create/upload: mutate, non-destructive, NOT idempotent (a repeat may make a new thing). */
const CREATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
/** Delete: destructive (soft-delete is still data loss from the caller's view). */
const DESTROY = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function okResult(data: unknown): CallToolResult {
  // 204/no-content writes resolve to `undefined` — render a friendly ack rather
  // than JSON.stringify(undefined) (which isn't a string).
  const text = data === undefined ? "OK (no content)." : JSON.stringify(data, null, 2);
  const content = [{ type: "text" as const, text }];
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
        "Search your reports by title/slug text. Returns a cursor-paginated list " +
        "({object:'list', data, has_more}); each item has id (report_…), slug, title, " +
        "is_published, folder_id. Read-only. Page with starting_after; omit `q` to list all.",
      inputSchema: {
        q: z.string().optional().describe("Free-text match on title/slug. Omit to list all."),
        folder_id: z.string().optional().describe("Restrict to this folder_ id."),
        limit: z.number().int().positive().optional().describe("Max items (1–100, default 20)."),
        starting_after: z
          .string()
          .optional()
          .describe("Cursor: a report_ id; returns items AFTER it (page forward)."),
        ending_before: z
          .string()
          .optional()
          .describe("Cursor: a report_ id; returns items BEFORE it (page back)."),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      toToolResult(
        await client.searchReports({
          q: args.q,
          folderId: args.folder_id,
          limit: args.limit,
          startingAfter: args.starting_after,
          endingBefore: args.ending_before,
        }),
      ),
  );

  server.registerTool(
    "reports_get",
    {
      title: "Get a report",
      description:
        "Fetch a single report by its slug — returns slug, title, is_published, folder_id, and " +
        "owner (the owning user's user_… id, ADR-0059). Read-only. Use it to confirm a report " +
        "exists / check its current title or folder before an update, move, or delete. A slug " +
        "that isn't yours (or doesn't exist) returns not-found.",
      inputSchema: {
        slug: z.string().describe("The report's slug or its report_ id (from reports_search)."),
      },
      annotations: READ_ONLY,
    },
    async (args) => toToolResult(await client.getReport(args.slug)),
  );

  server.registerTool(
    "reports_get_acl",
    {
      title: "Get a report's sharing settings",
      description:
        "Read a report's sharing acl — returns { object:'acl', mode, and for allowlist the " +
        "allowed_emails + access_ttl_seconds }. Read-only and OWNER-ONLY (ADR-0059): only the " +
        "user who created the report can read its share config. mode is one of private " +
        "(owner-only, the default) | public | password | org | allowlist. Use it before " +
        "reports_set_acl to see the current sharing state.",
      inputSchema: {
        slug: z.string().describe("The report's slug or its report_ id."),
      },
      annotations: READ_ONLY,
    },
    async (args) => toToolResult(await client.getReportAcl(args.slug)),
  );

  server.registerTool(
    "folders_list",
    {
      title: "List folders",
      description:
        "List your folder tree as a cursor-paginated list ({object:'list', data, has_more}); " +
        "each item has id (folder_…), name, slug, parent_id. Read-only. Use a folder_ id with " +
        "reports_search to scope a search, or when deciding where to organize a report.",
      inputSchema: {
        limit: z.number().int().positive().optional().describe("Max items (1–100, default 20)."),
        starting_after: z
          .string()
          .optional()
          .describe("Cursor: a folder_ id; returns items AFTER it (page forward)."),
        ending_before: z
          .string()
          .optional()
          .describe("Cursor: a folder_ id; returns items BEFORE it (page back)."),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      toToolResult(
        await client.listFolders({
          limit: args.limit,
          startingAfter: args.starting_after,
          endingBefore: args.ending_before,
        }),
      ),
  );
}

/** Register the write tools on `server`, backed by `client`. */
export function registerWriteTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "reports_upload",
    {
      title: "Upload a report",
      description:
        "Create a report from an HTML document, or re-upload a new version of an existing " +
        "one (re-upload is owner-gated, ADR-0059 — only the report's owner can update it). " +
        "Returns the slug + permanent view URL. To set/change the title afterwards use " +
        "reports_update. Title is not set here.",
      inputSchema: {
        html: z.string().describe("The report's full HTML document."),
        update_slug: z
          .string()
          .optional()
          .describe(
            "Re-upload a new version under this existing slug (keeps the URL). Omit to create new.",
          ),
        folder_path: z
          .string()
          .optional()
          .describe(
            "Create-only: place a NEW report at this folder path (e.g. '/q3'). Cannot combine with update_slug.",
          ),
      },
      annotations: CREATE,
    },
    async (args) =>
      toToolResult(
        await client.uploadReport({
          html: args.html,
          updateSlug: args.update_slug,
          folderPath: args.folder_path,
        }),
      ),
  );

  server.registerTool(
    "reports_update",
    {
      title: "Rename a report",
      description:
        "Change a report's title. Owner-gated (ADR-0059): only the report's owner can rename it. " +
        "Find its slug with reports_search first.",
      inputSchema: {
        slug: z.string().describe("The report's slug or its report_ id."),
        title: z.string().describe("The new title."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.renameReport(args.slug, args.title)),
  );

  server.registerTool(
    "reports_move",
    {
      title: "Move a report",
      description:
        "Move a report into a different folder. Owner-gated (ADR-0059): only the report's owner " +
        "can move it. Use folders_list to find the folder id.",
      inputSchema: {
        slug: z.string().describe("The report's slug or its report_ id."),
        folder_id: z.string().describe("The destination folder_ id (from folders_list)."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.moveReport(args.slug, args.folder_id)),
  );

  server.registerTool(
    "reports_set_acl",
    {
      title: "Set a report's sharing settings",
      description:
        "Set how a report is shared (ADR-0056). OWNER-ONLY (ADR-0059): only the user who created " +
        "the report can change its sharing. mode: 'private' (owner-only — only you can view, " +
        "the default for new reports), 'public' (anyone with the link), 'password' (requires " +
        "`password`), 'allowlist' (only `allowed_emails` — each is emailed a one-time magic link; " +
        "optional `access_ttl_seconds` sets how long their access lasts), or 'org'. REPLACES the " +
        "whole acl — send the COMPLETE allowed_emails list, not a delta. Use reports_get_acl first.",
      inputSchema: {
        slug: z.string().describe("The report's slug or its report_ id."),
        mode: z
          .enum(["private", "public", "password", "org", "allowlist"])
          .describe("The sharing mode."),
        allowed_emails: z
          .array(z.string())
          .optional()
          .describe(
            "allowlist mode: the FULL list of emails allowed to view (replaces any existing).",
          ),
        password: z.string().optional().describe("password mode: the viewing password."),
        access_ttl_seconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "allowlist mode: how long granted access lasts (60–7776000; default 604800 = 7d).",
          ),
      },
      annotations: MUTATE,
    },
    async (args) =>
      toToolResult(
        await client.setReportAcl(args.slug, {
          mode: args.mode,
          allowedEmails: args.allowed_emails,
          password: args.password,
          accessTtlSeconds: args.access_ttl_seconds,
        }),
      ),
  );

  server.registerTool(
    "reports_delete",
    {
      title: "Delete a report",
      description:
        "Delete a report (the viewer then returns 410 Gone). OWNER-ONLY (ADR-0059): only the " +
        "user who created the report can delete it. Destructive — confirm intent first.",
      inputSchema: { slug: z.string().describe("The report's slug.") },
      annotations: DESTROY,
    },
    async (args) => toToolResult(await client.deleteReport(args.slug)),
  );

  server.registerTool(
    "folders_create",
    {
      title: "Create a folder",
      description:
        "Create a folder under a parent. `parent_id` is required — new folders nest under an " +
        "existing one; use folders_list to find the root (or another) folder id.",
      inputSchema: {
        name: z.string().describe("The folder name."),
        parent_id: z.string().describe("Parent folder_ id (required; from folders_list)."),
      },
      annotations: CREATE,
    },
    async (args) =>
      toToolResult(await client.createFolder({ name: args.name, parentId: args.parent_id })),
  );

  server.registerTool(
    "folders_rename",
    {
      title: "Rename a folder",
      description: "Change a folder's name. Use folders_list to find its id.",
      inputSchema: {
        id: z.string().describe("The folder_ id (from folders_list)."),
        name: z.string().describe("The new name."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.renameFolder(args.id, args.name)),
  );

  server.registerTool(
    "folders_delete",
    {
      title: "Delete a folder",
      description:
        "Delete a folder. Blocked (error) if it still contains reports or subfolders. Destructive.",
      inputSchema: { id: z.string().describe("The folder_ id (from folders_list).") },
      annotations: DESTROY,
    },
    async (args) => toToolResult(await client.deleteFolder(args.id)),
  );
}

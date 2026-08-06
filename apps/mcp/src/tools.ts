// MCP tool definitions (ADR-0051). Each tool is a thin wrapper over the ApiClient:
// it calls `/api/v1` and maps the result into an MCP `CallToolResult`. Tools are
// intent-level + domain-prefixed; read tools carry read-only annotations. Upstream
// RFC-9457 problems become `isError` results (with secrets left out — the API's
// problem bodies are already safe, machine-readable, ADR-0040) so the model can
// react instead of the call throwing a protocol error.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ACL_MODES, COMMENT_INTENTS, FOLDER_VISIBILITIES, REPORT_SHARING_STATES } from "arp-domain";
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

// Shared input-schema helpers (schema-side DRY only — the emitted JSON schema:
// types, optionality, description strings, is identical to the previous
// per-tool declarations; tools.test.ts pins them verbatim).

/** The "slug or report_ id" input every slug-addressed tool shares.
 *  (reports_get and reports_delete carry their own description variants.) */
const SLUG_INPUT = z.string().describe("The report's slug or its report_ id.");

/** The ADR-0053 cursor-pagination trio, parameterized by the entity whose
 *  prefixed id is the cursor. */
function cursorInputs(entity: "report" | "version" | "comment" | "folder") {
  return {
    limit: z.number().int().positive().optional().describe("Max items (1–100, default 20)."),
    starting_after: z
      .string()
      .optional()
      .describe(`Cursor: a ${entity}_ id; returns items AFTER it (page forward).`),
    ending_before: z
      .string()
      .optional()
      .describe(`Cursor: a ${entity}_ id; returns items BEFORE it (page back).`),
  };
}

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
        ...cursorInputs("report"),
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
        "Fetch a single report by its slug — returns slug, title, is_published, folder_id, " +
        "owner (the owning user's user_… id, ADR-0059), and sharing: 'private' | 'org_view' | " +
        "'org_edit' | null (ADR-0078). Read `sharing`, NOT acl.mode, to tell how a report is " +
        "shared: org_view and org_edit have the SAME acl mode ('org') and differ only in an " +
        "org write grant the acl cannot express. null means an advanced mode " +
        "(password/allowlist/public) — use reports_get_acl for that. The acl block itself is " +
        "included only when you are the report's owner. Also returns editability: 'editable' | " +
        "'unsplittable' | 'unparsable' | null — whether the LIVE version can be opened in the " +
        "editor (ADR-0080). null means UNKNOWN (never probed), NOT un-editable. " +
        "Read-only. Use it to confirm a report " +
        "exists / check its title, folder or sharing before an update, move, or delete. A " +
        "missing slug returns not-found; a report outside your org returns forbidden.",
      inputSchema: {
        slug: z.string().describe("The report's slug or its report_ id (from reports_search)."),
      },
      annotations: READ_ONLY,
    },
    async (args) => toToolResult(await client.getReport(args.slug)),
  );

  server.registerTool(
    "reports_list_versions",
    {
      title: "List a report's version history",
      description:
        "List a report's ReportVersion history (ADR-0065) as a cursor-paginated list " +
        "({object:'list', data, has_more}), newest-created first; each item has id " +
        "(version_…), version_no, uploaded_by (user_…), uploaded_at, scan_status, " +
        "size_bytes, origin ('upload' | 'editor'), and editability ('editable' | 'unsplittable' " +
        "| 'unparsable' | null — whether THAT version's bytes can be opened in the editor, " +
        "ADR-0080; null means UNKNOWN, not un-editable). Read-only. Page with starting_after.",
      inputSchema: {
        slug: SLUG_INPUT,
        ...cursorInputs("version"),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      toToolResult(
        await client.listReportVersions(args.slug, {
          limit: args.limit,
          startingAfter: args.starting_after,
          endingBefore: args.ending_before,
        }),
      ),
  );

  server.registerTool(
    "reports_get_acl",
    {
      title: "Get a report's sharing settings",
      description:
        "Read a report's sharing acl — returns { object:'acl', mode, for allowlist the " +
        "allowed_emails + access_ttl_seconds, and sharing }. Read-only and OWNER-ONLY " +
        "(ADR-0059): only the user who created the report can read its share config. mode is " +
        "one of private (owner-only, the default) | public | password | org | allowlist. " +
        "sharing is the composed three-state answer (ADR-0078): 'private' | 'org_view' | " +
        "'org_edit' | null. READ `sharing`, NOT `mode`, to decide whether the org can EDIT: " +
        "org_view and org_edit both have mode 'org' and differ only in an org write grant the " +
        "acl cannot express, so inferring from mode alone gets it wrong. Use it before " +
        "reports_set_acl or reports_set_sharing to see the current state.",
      inputSchema: {
        slug: SLUG_INPUT,
      },
      annotations: READ_ONLY,
    },
    async (args) => toToolResult(await client.getReportAcl(args.slug)),
  );

  server.registerTool(
    "reports_list_write_grants",
    {
      title: "List who can write a report",
      description:
        "List everyone the owner has granted write access (rename/re-upload/move) on a report " +
        "(ADR-0060) — returns a list of { object:'write_grant', email, granted_by, granted_at }. " +
        "Read-only and OWNER-ONLY: only the user who created the report can see its write-grant " +
        "roster. Distinct from reports_get_acl (that's VIEW access; this is WRITE access).",
      inputSchema: {
        slug: SLUG_INPUT,
      },
      annotations: READ_ONLY,
    },
    async (args) => toToolResult(await client.listWriteGrants(args.slug)),
  );

  server.registerTool(
    "reports_list_comments",
    {
      title: "List a report's comments",
      description:
        "List a report's Comments (ADR-0064) as a cursor-paginated list " +
        "({object:'list', data, has_more}), newest-created first; each item has id " +
        "(comment_…), report_id, author_id (user_…), parent_id (a comment_ id when it's a " +
        "reply, else null), body, anchor ({ version_pinned: { version_id, text_quote } }), " +
        "resolved_at (null until resolved), and created_at. Read-only; comments never appear " +
        "on the public viewer. Page with starting_after.",
      inputSchema: {
        slug: SLUG_INPUT,
        ...cursorInputs("comment"),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      toToolResult(
        await client.listComments(args.slug, {
          limit: args.limit,
          startingAfter: args.starting_after,
          endingBefore: args.ending_before,
        }),
      ),
  );

  server.registerTool(
    "folders_list",
    {
      title: "List folders",
      description:
        "List the folders YOU can see (ADR-0076: yours + org-visible + shared-with-you + " +
        "legacy) as a cursor-paginated list ({object:'list', data, has_more}); each item has " +
        "id (folder_…), name, slug, parent_id, visibility (private|org), and owner (a user_ " +
        "id, or null for a legacy pre-ownership folder). Read-only. Use a folder_ id with " +
        "reports_search to scope a search, or when deciding where to organize a report.",
      inputSchema: {
        ...cursorInputs("folder"),
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

  server.registerTool(
    "folders_list_shares",
    {
      title: "List who a folder is shared with",
      description:
        "List everyone a folder's owner has shared its VISIBILITY with (ADR-0076) — returns a " +
        "list of { object:'folder_share', email, granted_by, granted_at }. Read-only and " +
        "OWNER-only (or any member for a legacy owner-less folder); requires the `acl:write` " +
        "scope. Distinct from reports_get_acl (report VIEW access) and " +
        "reports_list_write_grants (report WRITE access) — this is folder-tree visibility.",
      inputSchema: {
        id: z.string().describe("The folder_ id (from folders_list)."),
      },
      annotations: READ_ONLY,
    },
    async (args) => toToolResult(await client.listFolderShares(args.id)),
  );
}

/** Register the write tools on `server`, backed by `client`. */
export function registerWriteTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "reports_upload",
    {
      title: "Upload a report",
      description:
        "Create a report from an HTML document — returns the slug + a permanent `view_url` " +
        "you can share immediately. To PUBLISH A NEW VERSION of that same report later " +
        "(after edits/re-generation), call this again with `update_slug` set to its slug: " +
        "the `view_url` stays exactly the same, only the content and version number change " +
        "(re-upload requires write access, ADR-0059/0060 — the report's owner or a write " +
        "grantee). To set/change the title afterwards use reports_update. Title is not set here. " +
        "The response also carries editability: 'editable' | 'unsplittable' | 'unparsable' | " +
        "null (ADR-0080) — whether what you just published can be opened in the editor. " +
        "'unsplittable' means your HTML had no usable <body> (you sent a fragment); " +
        "'unparsable' means the body defeated the editor's parser; null means UNKNOWN. This is " +
        "NOT an error: the upload succeeded and the report still views perfectly at view_url. " +
        "Re-upload a full <html><body>…</body></html> document if you want it to be editable.",
      inputSchema: {
        html: z
          .string()
          .describe(
            "The report's full HTML document. Served byte-for-byte — there is no " +
              "serve-time rewriting — so what you emit is what readers get. LINK " +
              "CONVENTIONS (ADR-0062 Amendment 3; nothing adds these for you): give the " +
              'target an `id` and point in-page links at it (`<a href="#summary">` → ' +
              '`<section id="summary">`); put `target="_blank" rel="noopener noreferrer"` on ' +
              "every EXTERNAL link you want to open in a new tab. Anchor BLOCK elements only " +
              "(`section`, `h1`-`h6`, `p`, `div`, `li`, `td`, `blockquote`): editing a report " +
              "and saving re-serializes it, and `id` is NOT retained on the inline elements " +
              "modelled as marks (`span`, `a`, `code`, `strong`, `em`), so `<span id>` " +
              "becomes a dead anchor. That save also normalizes: a `target` other than " +
              '`_blank` and `rel="opener"` are dropped as frame-escape/tabnabbing ' +
              "primitives, unrecognized `rel` tokens are dropped, `style` is sanitized, and " +
              "attribute order is not preserved.",
          ),
        update_slug: z
          .string()
          .optional()
          .describe(
            "Publish a new version under this existing slug instead of creating a new report " +
              "— the view_url is unchanged. Omit to create a brand-new report.",
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
        "Change a report's title. Requires write access (ADR-0059/0060): the report's owner or " +
        "a write grantee. Find its slug with reports_search first.",
      inputSchema: {
        slug: SLUG_INPUT,
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
        "Move a report into a different folder. Requires write access (ADR-0059/0060): the " +
        "report's owner or a write grantee. The destination folder must be in the REPORT's org " +
        "AND visible to you (ADR-0076) — a folder you cannot see reads as NOT FOUND, since its " +
        "existence is private. Use folders_list to find the folder id: it lists exactly the " +
        "folders you may target.",
      inputSchema: {
        slug: SLUG_INPUT,
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
        slug: SLUG_INPUT,
        mode: z.enum(ACL_MODES).describe("The sharing mode."),
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
    "reports_set_sharing",
    {
      title: "Set who in your org can view or edit a report",
      description:
        "Set a report's sharing in ONE step (ADR-0078): 'private' (only you), 'org_view' " +
        "(everyone in your org can view), or 'org_edit' (everyone in your org can view AND " +
        "edit). OWNER-ONLY; requires the `acl:write` scope. Read and write are always paired — " +
        "'org_edit' also grants viewing, so this can never give people edit access to something " +
        "they cannot open. DELETE stays owner-only in every option. Prefer this over " +
        "reports_set_acl for org sharing; use reports_set_acl when you need a password, an " +
        "invite list, or a public link, and reports_grant_write to give ONE named person edit " +
        "access instead of the whole org. If the report currently uses password, allowlist or " +
        "public, this REFUSES with an explanation of what would be lost — re-send with " +
        "confirm_discard: true only if the user has agreed to lose that setting.",
      inputSchema: {
        slug: SLUG_INPUT,
        sharing: z.enum(REPORT_SHARING_STATES).describe("The target sharing state."),
        confirm_discard: z
          .boolean()
          .optional()
          .describe(
            "Only needed when the report currently uses password/allowlist/public. " +
              "Acknowledges that the setting will be permanently discarded.",
          ),
      },
      annotations: MUTATE,
    },
    async (args) =>
      toToolResult(
        await client.setReportSharing(args.slug, {
          sharing: args.sharing,
          confirmDiscard: args.confirm_discard,
        }),
      ),
  );

  server.registerTool(
    "reports_grant_write",
    {
      title: "Grant someone write access to a report",
      description:
        "Grant another person the ability to rename, re-upload, or move a specific report — " +
        "NOT delete/set_acl/manage grants, which stay owner-only (ADR-0060). OWNER-ONLY; " +
        "requires the `acl:write` scope. Works CROSS-ORG — the grantee is typically outside " +
        "your org (they don't need to have signed up yet; the grant matches by email once they " +
        "do). Confers NO view access by itself — share viewing separately with reports_set_acl " +
        "if they also need to open it in the viewer. The result carries `open_url` — share it " +
        "with the grantee: it opens the editor for them (no notification is sent otherwise).",
      inputSchema: {
        slug: SLUG_INPUT,
        email: z.string().describe("The grantee's email address."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.grantWrite(args.slug, args.email)),
  );

  server.registerTool(
    "reports_revoke_write",
    {
      title: "Revoke someone's write access to a report",
      description:
        "Revoke a previously granted write access (ADR-0060). OWNER-ONLY; requires the " +
        "`acl:write` scope. Idempotent — revoking an email with no grant still succeeds. Use " +
        "reports_list_write_grants first to see who currently has write access.",
      inputSchema: {
        slug: SLUG_INPUT,
        email: z.string().describe("The grantee's email address to revoke."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.revokeWrite(args.slug, args.email)),
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
    "reports_add_comment",
    {
      title: "Add a comment (or reply) to a report",
      description:
        "Create a comment on a report (ADR-0064), or a REPLY to an existing comment when you " +
        "pass parent_comment_id. Requires write access (canWrite, ADR-0064 §3): the report's " +
        "owner or a write grantee. The comment is anchored to a specific ReportVersion and the " +
        "exact quoted text it refers to (version_id + text_quote — get a version_ id from " +
        "reports_list_versions). Returns the created comment resource (id comment_…, parent_id " +
        "set for a reply else null, body, anchor, resolved_at:null, created_at). Comments are " +
        "private to the org — they never show on the public viewer.",
      inputSchema: {
        slug: SLUG_INPUT,
        body: z.string().describe("The comment text."),
        version_id: z
          .string()
          .describe("The version_ id this comment is pinned to (from reports_list_versions)."),
        text_quote: z
          .string()
          .describe("The exact quoted text in that version the comment refers to."),
        relative: z
          .unknown()
          .optional()
          .describe(
            "Optional editor anchor hint, forwarded opaquely (position within the quoted text).",
          ),
        parent_comment_id: z
          .string()
          .optional()
          .describe("Reply to this comment_ id. Omit to create a top-level (root) comment."),
      },
      annotations: CREATE,
    },
    async (args) =>
      toToolResult(
        await client.addComment(args.slug, {
          body: args.body,
          versionId: args.version_id,
          textQuote: args.text_quote,
          relative: args.relative,
          parentCommentId: args.parent_comment_id,
        }),
      ),
  );

  server.registerTool(
    "reports_resolve_comment",
    {
      title: "Resolve a comment",
      description:
        "Mark a comment as resolved (ADR-0064) — sets its resolved_at. Allowed for the comment's " +
        "AUTHOR or the report's OWNER (a different rule from the write-access gate on add). " +
        "One-way and idempotent: there is only one resolved transition (no un-resolve today), so " +
        "resolving an already-resolved comment is safe. Returns the updated comment resource.",
      inputSchema: {
        slug: SLUG_INPUT,
        comment_id: z.string().describe("The comment_ id to resolve (from reports_list_comments)."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.resolveComment(args.slug, args.comment_id)),
  );

  server.registerTool(
    "reports_edit_comment",
    {
      title: "Edit a comment",
      description:
        "Edit a comment's text (`body`) and/or its `intent` (ADR-0064) — fix a typo or change " +
        "what the comment asks an agent to do. Allowed for the comment's AUTHOR or the report's " +
        "OWNER (the same rule as resolve/delete, NOT the write-access gate on add). Supply at " +
        "least one of body/intent; an omitted field is left unchanged. intent is one of note | " +
        "enhancement | add | remove (an invalid value is rejected). The anchor is immutable and " +
        "cannot be edited. Returns the updated comment resource.",
      inputSchema: {
        slug: SLUG_INPUT,
        comment_id: z.string().describe("The comment_ id to edit (from reports_list_comments)."),
        body: z.string().optional().describe("New comment text. Omit to leave the body unchanged."),
        intent: z
          .enum(COMMENT_INTENTS)
          .optional()
          .describe("New intent. Omit to leave the intent unchanged."),
      },
      annotations: MUTATE,
    },
    async (args) =>
      toToolResult(
        await client.editComment(args.slug, args.comment_id, {
          body: args.body,
          intent: args.intent,
        }),
      ),
  );

  server.registerTool(
    "reports_delete_comment",
    {
      title: "Delete a comment",
      description:
        "Delete a comment (ADR-0064). Allowed for the comment's AUTHOR or the report's OWNER. " +
        "Destructive — confirm intent first. Use reports_list_comments to find the comment_ id.",
      inputSchema: {
        slug: SLUG_INPUT,
        comment_id: z.string().describe("The comment_ id to delete (from reports_list_comments)."),
      },
      annotations: DESTROY,
    },
    async (args) => toToolResult(await client.deleteComment(args.slug, args.comment_id)),
  );

  server.registerTool(
    "folders_create",
    {
      title: "Create a folder",
      description:
        "Create a folder to organize reports into — pair with reports_move (or reports_upload's " +
        "folder_path) once it exists. `parent_id` is required — new folders nest under an " +
        "existing one; use folders_list to find the root (or another) folder id. The new folder " +
        "is OWNED by you, and its visibility is PRIVATE when created under the Root (nobody else " +
        "sees it, not even its name), else inherited from the parent (ADR-0076). To let others " +
        "see it, use folders_share for specific people or folders_set_visibility for the whole " +
        "org.",
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

  server.registerTool(
    "folders_set_visibility",
    {
      title: "Set a folder's visibility",
      description:
        "Set who can SEE a folder (ADR-0076): `private` (only its owner + people it's shared " +
        "with via folders_share) or `org` (every org member). OWNER-only for owned folders; a " +
        "LEGACY folder (created before per-user ownership — `owner` is null in folders_list) is " +
        "ADOPTED: calling this makes YOU its owner. Requires the `acl:write` scope. The Root " +
        "folder is always org-visible and is never owned — calling this on it is an error in " +
        "either direction. Visibility gates the folder itself, not the reports inside it — " +
        "report access stays governed by each report's acl.",
      inputSchema: {
        id: z.string().describe("The folder_ id (from folders_list)."),
        visibility: z.enum(FOLDER_VISIBILITIES).describe("Who can see the folder."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.setFolderVisibility(args.id, args.visibility)),
  );

  server.registerTool(
    "folders_apply_sharing_to_reports",
    {
      title: "Share the reports inside a folder",
      description:
        "Apply a sharing state to the REPORTS INSIDE a folder (ADR-0078). Sharing a folder with " +
        "folders_set_visibility shows people the folder's NAME only — this is what reaches the " +
        "reports in it. Requires the `acl:write` scope. You must be able to see the folder; each " +
        "report is then authorized on its own, so ONLY REPORTS YOU OWN can change. A report is " +
        "changed only if you own it and it is currently in the state the direction starts from; " +
        "everything else is listed back to you untouched with a reason (not owned by you, " +
        "password-protected, allowlisted, already public, already at the destination). Always " +
        "read `skipped` and `failed` in the result before telling the user it worked — this tool " +
        "reports exactly what it did and did not change.",
      inputSchema: {
        id: z.string().describe("The folder_ id (from folders_list)."),
        sharing: z
          .enum(REPORT_SHARING_STATES)
          .describe("The state to apply to the reports inside the folder."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.applyFolderSharingToReports(args.id, args.sharing)),
  );

  server.registerTool(
    "folders_share",
    {
      title: "Share a folder with someone",
      description:
        "Give a specific person VISIBILITY of a folder by email (ADR-0076) — they can then see " +
        "it in their folder tree and target it when moving reports. Confers NO rename/delete/" +
        "create rights and NO access to the reports inside (share those with reports_set_acl / " +
        "reports_grant_write). OWNER-only (or any member for a legacy owner-less folder); " +
        "requires the `acl:write` scope. The grantee doesn't need an account yet — the share " +
        "matches by email once they sign up. A share is only EFFECTIVE for someone in the same " +
        "org as the folder: folder listings are org-scoped, so a grantee whose account lives in " +
        "another org never sees it. The grant is still recorded, and starts working if they " +
        "later join.",
      inputSchema: {
        id: z.string().describe("The folder_ id (from folders_list)."),
        email: z.string().describe("The grantee's email address."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.shareFolder(args.id, args.email)),
  );

  server.registerTool(
    "folders_unshare",
    {
      title: "Revoke someone's folder share",
      description:
        "Revoke a previously shared folder visibility (ADR-0076). OWNER-only (or any member " +
        "for a legacy owner-less folder); requires the `acl:write` scope. Idempotent — " +
        "unsharing an email with no share still succeeds. Use folders_list_shares to see who " +
        "currently has visibility.",
      inputSchema: {
        id: z.string().describe("The folder_ id (from folders_list)."),
        email: z.string().describe("The grantee's email address to revoke."),
      },
      annotations: MUTATE,
    },
    async (args) => toToolResult(await client.unshareFolder(args.id, args.email)),
  );
}

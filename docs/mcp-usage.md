# Using the MCP server

The platform ships a remote **Model Context Protocol** server at **`https://mcp.centaurspec.com/mcp`** so AI agents (Claude Desktop/Code, the MCP Inspector, anything MCP-aware) can manage your reports — upload, organise, rename, move, delete, search — without crafting raw HTTP. It's a thin client over the live `/api/v1` (ADR-0051); the API does the work.

## Connect

Two front doors, same tools. Pick by client.

### A. Browser login (OAuth) — no key to manage

Best for **Claude Desktop / claude.ai**. The server is an OAuth 2.1 resource server; the client self-registers (Dynamic Client Registration) and you sign in through Clerk.

1. Claude → **Settings → Connectors → Add custom connector**.
2. URL: `https://mcp.centaurspec.com/mcp` → **Add**.
3. A browser window opens → **sign in** (Clerk) → **consent**. The connector shows **Connected**; its tools appear in chat.

No config file, no pasted secret. (Requires the operator to have created the Clerk OAuth app with DCR — see `docs/infra.md`.)

### B. API key — headless / config-file clients

Best for **scripts, CI, Claude Desktop via config**. Mint a key at `https://app.centaurspec.com/settings/api-keys` (shown once).

- **Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) via the `mcp-remote` bridge:
  ```json
  {
    "mcpServers": {
      "arp-reports": {
        "command": "npx",
        "args": ["mcp-remote", "https://mcp.centaurspec.com/mcp", "--header", "Authorization:${AUTH_TOKEN}"],
        "env": { "AUTH_TOKEN": "Bearer arp_live_YOUR_KEY" }
      }
    }
  }
  ```
  (The `${AUTH_TOKEN}` indirection avoids Claude Desktop's space-splitting of `--header` args.)
- **Claude Code:** `claude mcp add --transport http arp-reports https://mcp.centaurspec.com/mcp --header "Authorization: Bearer arp_live_YOUR_KEY"`.
- **Raw smoke test:**
  ```bash
  curl -sS https://mcp.centaurspec.com/mcp \
    -H "Authorization: Bearer arp_live_YOUR_KEY" \
    -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

`GET /health` → `{"status":"ok"}` is the liveness check.

## Tools

| Tool | Kind | What |
|------|------|------|
| `reports_search` | read | Find reports by title/slug text (paginated). Omit `q` to list all. |
| `reports_get` | read | Fetch one report by slug (slug, title, is_published, folder_id). |
| `reports_list_versions` | read | List a report's version history, newest-created first (version_no, uploaded_by, uploaded_at, scan_status, size_bytes, origin). |
| `reports_list_comments` | read | List a report's comments, newest-created first (id, author_id, parent_id for replies, body, anchor, resolved_at, created_at). Comments never appear on the public viewer. |
| `folders_list` | read | The folder tree (id, name, parent id). |
| `reports_upload` | create | Create a report from HTML, or re-upload a new version of an existing slug. Returns the slug + permanent `view_url`. |
| `reports_add_comment` | create | Add a comment, or a reply (pass `parent_comment_id`), anchored to a version + quoted text. Requires write access. |
| `reports_update` | mutate | Rename a report's title. |
| `reports_move` | mutate | Move a report to a folder. |
| `reports_resolve_comment` | mutate | Mark a comment resolved (author or report owner; one-way, idempotent). |
| `reports_edit_comment` | mutate | Edit a comment's `body` and/or `intent` (author or report owner). At least one field; omitted fields unchanged. The anchor is immutable. |
| `reports_delete` | destructive | Soft-delete a report (viewer then returns 410 Gone). |
| `reports_delete_comment` | destructive | Delete a comment (author or report owner). |
| `folders_create` | create | Create a folder under a parent. |
| `folders_rename` | mutate | Rename a folder. |
| `folders_delete` | destructive | Delete a folder (blocked if it still has reports/subfolders). |

Reports are served on the separate viewer origin: `https://view.centaurspec.com/<slug>`.

## Agent onboarding (ADR-0072)

The server ships a short `instructions` string (set once, at connect, via the MCP `initialize`
response) that teaches an agent the core workflow before it ever calls a tool: **upload** an HTML
document with `reports_upload` to get a permanent `view_url` → **re-upload to the same slug**
(`update_slug`) to publish a new version while that URL stays exactly the same → use **folders**
to organize reports → use **comments** to read/resolve reviewer feedback. It also states plainly
that the server acts only within the caller's own grants — never another user's or org's data.

Not every client surfaces `instructions` to the model today (Claude Code/Gemini/Codex-style hosts
do; Claude Desktop currently does not), so the same story is reinforced directly in the relevant
tool descriptions (`reports_upload`, `folders_create`) as a fallback that reaches every client.
See `docs/adr/0072-mcp-agent-onboarding.md` for the full rationale, the cross-client mechanism
differences, and the planned follow-up layers (a portable `SKILL.md`, then a packaged Claude Code
plugin / Gemini extension / MCP prompts).

### Portable Agent Skill (Layer 1)

For a deeper, example-driven version of the same workflow — useful for hosts like Claude
Desktop that don't surface `instructions`, and installable in Claude Code, Claude Desktop,
Codex, and (reportedly) Gemini — see the standalone skill at
`apps/mcp/skill/centaur-spec/SKILL.md` (install notes per host in the sibling `README.md`).

## One-step packaging (Layer 2)

The deepest onboarding layer wraps the server connection and the Layer 1 skill into
installable, per-host packages, plus adds MCP **prompts** — a distinct SDK capability from
`instructions` — so a client can list and insert a ready-made instruction on demand. See
`docs/adr/0072-mcp-agent-onboarding.md` for the full rationale.

### Claude Code plugin

`apps/mcp/packaging/claude-code-plugin/` bundles the `arp-mcp` server connection
(`.mcp.json`, Streamable HTTP, no embedded secret — auth happens at connect time) together
with a packaged copy of the Layer 1 skill (`skills/centaur-spec/SKILL.md`) and a plugin
manifest (`.claude-plugin/plugin.json`). Install it as a Claude Code plugin (see the
package's own `README.md` for the current `/plugin` install flow) to get both the tool
connection and the workflow-teaching skill in one step, instead of connecting the MCP
server and separately finding the skill.

### Gemini extension

`apps/mcp/packaging/gemini-extension/` is the equivalent for Gemini CLI: a
`gemini-extension.json` manifest registers the same remote `arp-mcp` server under
`mcpServers` (via the `httpUrl` key for Streamable HTTP) and points `contextFileName` at a
bundled, trimmed context file (`GEMINI.md`) covering the core workflow and the
caller-scoped-access security note. See the package's `README.md` for the install command.

### MCP prompts

`apps/mcp/src/prompts.ts` registers three discoverable entry-point prompts on the server
itself via the SDK's `registerPrompt` — a distinct capability from `instructions` (sent
once at connect) and tool descriptions (attached to each tool). Hosts that support the
prompts capability (Claude Code, Gemini) surface these as `/mcp__arp-mcp__<name>` slash
commands the user can invoke directly:

| Prompt | What it does |
|---|---|
| `publish_report` | Upload an HTML document with `reports_upload` and return its shareable `view_url`. |
| `share_report` | Set who can view (`reports_get_acl`/`reports_set_acl`) or write (`reports_grant_write`/`reports_revoke_write`) an existing report. |
| `find_report` | Search reports with `reports_search` and open one with `reports_get`. |

Each prompt's message references the real tool names above and restates the
caller-scoped-access caveat — it performs no I/O of its own; the named tools remain the
only place a call actually reaches `/api/v1`. **Codex does not consume MCP prompts** — it
reads the skill and the sharpened tool descriptions (Layers 0/1) instead, which is why
those two layers, not prompts, are this project's cross-client baseline.

## Notes

- **Auth is downstream-honest:** whichever credential you present, the server resolves it to *your* org and the `/api/v1` use cases enforce ownership — an agent only ever sees your reports.
- **Idempotent uploads:** `reports_upload` derives an idempotency key from the content, so a retried upload won't duplicate.
- Errors come back as structured tool results (RFC-9457 problem details mapped to `isError`), never raw stack traces.

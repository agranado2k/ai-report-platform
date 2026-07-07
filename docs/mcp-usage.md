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
| `folders_list` | read | The folder tree (id, name, parent id). |
| `reports_upload` | create | Create a report from HTML, or re-upload a new version of an existing slug. Returns the slug + permanent `view_url`. |
| `reports_update` | mutate | Rename a report's title. |
| `reports_move` | mutate | Move a report to a folder. |
| `reports_delete` | destructive | Soft-delete a report (viewer then returns 410 Gone). |
| `folders_create` | create | Create a folder under a parent. |
| `folders_rename` | mutate | Rename a folder. |
| `folders_delete` | destructive | Delete a folder (blocked if it still has reports/subfolders). |

Reports are served on the separate viewer origin: `https://view.centaurspec.com/<slug>`.

## Notes

- **Auth is downstream-honest:** whichever credential you present, the server resolves it to *your* org and the `/api/v1` use cases enforce ownership — an agent only ever sees your reports.
- **Idempotent uploads:** `reports_upload` derives an idempotency key from the content, so a retried upload won't duplicate.
- Errors come back as structured tool results (RFC-9457 problem details mapped to `isError`), never raw stack traces.

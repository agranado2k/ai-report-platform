# Centaur Spec — Gemini CLI extension

Layer 2 of the onboarding rollout in `docs/adr/0072-mcp-agent-onboarding.md`: a one-step
installable Gemini CLI extension that bundles the remote Centaur Spec MCP server
connection together with a trimmed context file teaching the workflow, so Gemini gets both
the tools and the onboarding guidance in a single install.

## What it bundles

- **`gemini-extension.json`** — the extension manifest: registers the remote `arp-mcp`
  server (`https://mcp.centaurspec.com/mcp`, Streamable HTTP via the `httpUrl` key) under
  `mcpServers`, and points `contextFileName` at `GEMINI.md` so it's loaded as this
  extension's context automatically.
- **`GEMINI.md`** — a trimmed context file covering the core workflow (publish → version →
  organize → find → collaborate → share) and the caller-scoped-access security note. It is
  a condensed version of `apps/mcp/skill/centaur-spec/SKILL.md` (Layer 1) — for the deeper,
  example-driven version, see that file (or `docs/mcp-usage.md`).

No secret or token is embedded in `gemini-extension.json` — the first call to `arp-mcp`
triggers its own auth (OAuth sign-in via Clerk, or an `arp_` API key), the same as any other
client documented in `docs/mcp-usage.md`.

## Install

```
gemini extensions install <this-directory-or-git-source>
```

See the [Gemini CLI extensions docs](https://geminicli.com/docs/extensions/) for the
current install flow (local path, git URL, or a future extensions registry).

## Notes

- This package adds no new server capability — packaging only, over the same `arp-mcp`
  server documented in `docs/mcp-usage.md` (ADR-0051/0072).
- Keep `GEMINI.md` in sync with `apps/mcp/skill/centaur-spec/SKILL.md` and
  `apps/mcp/src/instructions.ts` — if a tool is renamed or the version-publish behavior
  changes, update all three in the same PR.

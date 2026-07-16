# Centaur Spec — Claude Code plugin

> **Canonical source**: `skills/centaur-spec/SKILL.md` in this directory is a **packaged copy**
> of `apps/mcp/skill/centaur-spec/SKILL.md` (Layer 1). Edit the canonical file when the workflow
> changes and re-copy it here in the same PR — don't edit this copy independently.

This is Layer 2 of the onboarding rollout in `docs/adr/0072-mcp-agent-onboarding.md`: a
one-step installable package that bundles the remote Centaur Spec MCP server connection
together with the workflow-teaching skill, so a user doesn't have to configure the MCP
server and separately go find/install the skill.

## What it bundles

- **`.mcp.json`** — points Claude Code at the remote MCP server `arp-mcp`
  (`https://mcp.centaurspec.com/mcp`, Streamable HTTP). No secret is embedded here: the
  first tool call triggers the server's own OAuth 2.1 flow (sign in via Clerk), or you can
  pre-authenticate with an `arp_` API key the same way documented in `docs/mcp-usage.md`.
- **`skills/centaur-spec/SKILL.md`** — the Layer 1 portable skill, teaching the
  publish → version → organize → share → comment workflow with worked examples, so the
  model doesn't have to reverse-engineer it from 16 independent tool descriptions.
- **`.claude-plugin/plugin.json`** — the plugin manifest (name, version, description,
  author) Claude Code reads to list/install this plugin.

## Install

Once this plugin is published to a marketplace (or added as a local/git marketplace
source), install it with:

```
/plugin install centaur-spec
```

or, for a local checkout / git source added via `/plugin marketplace add`:

```
/plugin marketplace add <this-repo-or-path>
/plugin install centaur-spec@<marketplace-name>
```

After install, Claude Code will prompt you to connect the bundled `arp-mcp` server (OAuth
sign-in or an API key) the first time a tool from it is used. See `docs/mcp-usage.md` for
both connection methods and the full tool table.

## Notes

- This package adds no new server capability — it is packaging only, over the same
  `arp-mcp` server documented in `docs/mcp-usage.md` (ADR-0051/0072). It does not change
  auth, transport, or the `/api/v1` contract.
- If the exact plugin manifest schema evolves, prefer the minimal, documented fields
  (`name`, `version`, `description`, `author`) over guessing undocumented ones.

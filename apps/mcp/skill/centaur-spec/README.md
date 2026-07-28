# Centaur Spec Agent Skill

A portable [Agent Skill](https://www.anthropic.com/engineering/agent-skills) that teaches
any MCP-aware coding agent the Centaur Spec reports workflow — upload, publish new
versions under a stable link, organize into folders, share, and comment. It pairs with
the remote MCP server at `https://mcp.centaurspec.com/mcp` (see `docs/mcp-usage.md` for
how to connect that server itself); this skill only adds the *workflow knowledge* on top,
it doesn't replace connecting the MCP server.

This is Layer 1 of the onboarding rollout in `docs/adr/0072-mcp-agent-onboarding.md`.
Layer 0 (already shipped) is the server's own `instructions` string plus sharpened tool
descriptions — those reach Claude Code, Gemini, and Codex-style hosts automatically at
connect time, but not Claude Desktop. This skill file is the piece Desktop-class clients
(and anyone else who wants the deeper version with worked examples) install directly.

## Install per host

### Claude Code

Drop this directory into a skills directory Claude Code loads, e.g. a project's
`.claude/skills/centaur-spec/` (copy `SKILL.md`, the README is optional there). Once
Layer 2 ships, it will also be installable in one step as part of a Claude Code plugin —
see `docs/adr/0072-mcp-agent-onboarding.md`.

### Claude Desktop

Claude Desktop supports Agent Skills as files you upload/attach in a project, or (on
newer versions) a skills folder in its settings. Add `SKILL.md` there. This is the
highest-value install target for this skill specifically, since Desktop does not
currently surface the MCP server's `instructions` field — this file is the only channel
that reaches the model on that client today.

### Codex

Codex supports the Agent Skills convention directly — place `SKILL.md` in the skills
location Codex reads from (consult Codex's current docs for the exact path, as this is
evolving). No changes are needed to this file to make it Codex-compatible; the
frontmatter intentionally uses only the portable `name`/`description` keys.

### Gemini

Gemini CLI/Code Assist has reported support for the Agent Skills convention as well;
install the same way (drop `SKILL.md` where Gemini looks for skills). Once Layer 2 ships,
a Gemini extension will bundle this skill for one-step install — see
`docs/adr/0072-mcp-agent-onboarding.md`.

## Notes

- This file (and `SKILL.md`) is first-party, reviewed content — trusted the same way any
  other file in this repo is. It teaches an agent how to use the MCP server; it is not
  itself a substitute for connecting the server (you still need OAuth or an API key —
  see `docs/mcp-usage.md`).
- Keep this skill in sync with `apps/mcp/src/instructions.ts` and `apps/mcp/src/tools.ts`
  — if a tool is renamed or the version-publish behavior changes, update `SKILL.md` in
  the same PR.

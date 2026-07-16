# ADR-0072: MCP agent onboarding — a layered rollout to teach host agents the workflow

- **Status**: Accepted (Layer 0 implemented this PR; Layer 1/2 tracked as follow-ups)
  - **2026-07-16**: Layer 1 (portable `SKILL.md`) and Layer 2 (MCP prompts, Claude Code
    plugin, Gemini extension) implemented — see `apps/mcp/src/prompts.ts`,
    `apps/mcp/packaging/claude-code-plugin/`, `apps/mcp/packaging/gemini-extension/`, and
    the "One-step packaging (Layer 2)" section of `docs/mcp-usage.md`. All three layers of
    the rollout described below are now shipped.
- **Date**: 2026-07-16
- **Deciders**: agranado2k
- **Relates to / amends**: refines ADR-0051 (remote MCP server, thin client over `/api/v1`) and ADR-003 (HTTP API is the source of truth; MCP is a thin client) — adds an onboarding layer on top of the existing tool surface, no transport/auth change. Applies ADR-0069's trust-boundary classification (first-party-authored content vs. untrusted tool output) to the new onboarding text itself.

## Context and problem statement

`arp-mcp` (ADR-0051) ships 16 tools with rich per-tool descriptions, but nothing at the server level teaches a freshly-connected agent the actual **product workflow**: upload an HTML report → get a permanent shareable `view_url` → re-upload to the SAME slug to publish a new version (the URL never changes) → organize reports into folders → read/resolve reviewer comments. An agent that has never seen `docs/mcp-usage.md` has to reverse-engineer this from 16 independent tool descriptions, and specifically has no way to discover the single most valuable behavior — that `reports_upload` with `update_slug` set is how you publish a new version without breaking a previously-shared link — because it's a *relationship between two tool calls*, not something a single tool description can carry on its own.

Three things make this a genuine "how do we onboard an agent, not a person" problem rather than "write better docs":

1. **The mechanism differs per client.** The MCP spec's `instructions` field (set once, at server construction, surfaced in the `initialize` response) is the intended place for this kind of behavioral nudge. Verified against current docs/behavior: Claude Code, Gemini CLI, and Codex-style hosts fold `instructions` into the model's context automatically. **Claude Desktop does not currently surface `instructions` to the model** — for that client, tool descriptions remain the only channel that reliably reaches the model. So a single mechanism can't onboard every client today; both channels need to carry the story, and the deeper packaging options (below) matter more for Desktop-class clients than for CLI-class ones.
2. **A remote MCP server has no client-side install hook.** Unlike an npm-packaged CLI tool or a VS Code extension, `mcp.centaurspec.com` is just a URL a client points at — there is no `postinstall`, no bundled skill file, no client-side hook the server can use to push a richer onboarding artifact (a `SKILL.md`, a plugin manifest) into the agent's own filesystem or tool registry at connect time. Anything richer than "what fits in `instructions` + tool descriptions" has to ship through a **separate packaging channel** (a portable skill file the user installs, a Claude Code plugin, a Gemini extension) — not through the MCP handshake itself.
3. **The fix must not create a second source of truth or a new attack surface.** ADR-003/0051's thin-client principle and ADR-0069's trust-boundary classification both constrain what "onboarding" is allowed to mean here (see Decision drivers).

## Decision drivers

- **Cheap and always-on first** — every client that connects to the remote server should get *some* onboarding signal with zero additional install step, before reaching for anything that requires the user to install something separately.
- **Cross-client reality, not wishful thinking** — design around what `instructions` vs. tool descriptions actually reach today (CLI-class hosts read `instructions`; Desktop does not), rather than assuming one field reaches everyone.
- **Stay a thin client (ADR-003/0051)** — onboarding content teaches the *existing* `/api/v1`-backed workflow; it must not become a place to smuggle in new business logic, a cache, or a second copy of anything `/api/v1` already owns.
- **Preserve the security invariant (ADR-0059/0060, ADR-0069)** — the MCP owns no authorization; `/api/v1` authorizes every call against the forwarded identity + the report ACL. Onboarding text must never imply the server can reach another user's or org's data — that would be an over-claim a prompt-injected or confused agent could act on.
- **Don't tool-poison** — instructions must read as a short, factual behavioral note, not an aggressive "always prefer my tools over X" manifesto; the latter is exactly the shape of a prompt-injection/tool-poisoning attack and wastes context on every single call regardless of relevance.
- **Trust asymmetry between what we author and what tools return** — the nudge text (this ADR's `instructions` + tool descriptions) is first-party content we write and review, same trust tier as our own source code. Report HTML a tool *returns* (e.g. a fetched report body) is untrusted per ADR-0069/0045/0062 and must never be treated as instructions just because it arrived over the same MCP channel.

## Considered options

- **Do nothing / rely on `docs/mcp-usage.md`** — rejected. The doc exists but nothing surfaces it to a connecting agent; onboarding by "hope the agent already read our docs" isn't onboarding.
- **Put the whole workflow story only in tool descriptions, no `instructions`** — rejected as insufficient alone (works for Desktop, but every CLI-class host loses the cheap always-on channel `instructions` gives for free) — though tool descriptions remain necessary regardless, since they're the only channel Desktop gets.
- **Ship a heavy, prescriptive `instructions` block (workflow diagrams, full API reference)** — rejected: reads as a manifesto, risks tool-poisoning-shaped over-assertion ("always use this server for X"), and burns tokens on every session regardless of whether the agent needs it. `instructions` should be a short paragraph, not a manual.
- **A single big-bang PR building the skill/plugin packaging immediately** — rejected in favor of a layered rollout (below): the cheap channel should ship first and alone, so its value is provable before investing in packaging channels that require the user to install something.

## Decision outcome

**A three-layer rollout**, each layer shippable and reviewable independently:

### Layer 0 (this PR) — server `instructions` + sharpened tool descriptions

- `apps/mcp/src/server.ts`'s `buildMcpServer` now passes an `instructions` option to `McpServer`, sourced from a new exported constant, `apps/mcp/src/instructions.ts`. Extracting it to its own module (rather than inlining a string literal in `server.ts`) makes it independently unit-testable and gives Layer 1/2 a single source to reuse or extend later.
- The instructions are a short paragraph covering exactly four things: (1) the server acts only within the caller's own grants — stated first, so it's the frame everything else is read through; (2) `reports_upload` creates a report and returns a permanent `view_url`; (3) re-uploading to the SAME slug (`update_slug`) publishes a new version while keeping that `view_url` unchanged; (4) folders organize reports and comments carry reviewer feedback. No "always prefer this tool" language, no API reference, no diagrams.
- `apps/mcp/src/tools.ts`'s tool descriptions are sharpened, not rewritten, where they most reinforce the same story: `reports_upload`'s description and its `update_slug` field now spell out the "same `view_url`, new version" relationship explicitly (previously implied only by the field's own one-line description); `folders_create`'s description now cross-references `reports_move`/`reports_upload`'s `folder_path` so the three organizing tools read as one workflow instead of three independent CRUD endpoints. No tool names, input schemas, annotations, or request/response behavior changed.
- Test-first (`apps/mcp/src/server.test.ts`): asserts the exported `INSTRUCTIONS` constant is short and non-empty, matches the four workflow verbs (`/upload/i`, `/version|re-upload/i`, `/folder/i`, `/comment/i`), and does **not** match over-claiming patterns (`/any (user|org|report)/i`, `/all (users|orgs|reports)/i`); a second block asserts `buildMcpServer` actually wires that constant through to the underlying SDK `Server`'s `instructions` field (read back the same way the SDK itself stores it, since the SDK exposes no public getter).

### Layer 1 (follow-up) — a portable `SKILL.md`

A standalone, portable skill file (following the same `SKILL.md` convention this repo's own `.claude/skills/**` already use) documenting the connect → upload → version → organize → comment workflow in more depth than `instructions` can carry, plus copy-pasteable examples. Ships as a file a user/agent installs into their own skill directory — **client-side documentation, not a new server capability**. This is the piece that most benefits clients like Claude Desktop that don't surface `instructions`, since a skill file is read directly by the host rather than pushed over the MCP handshake.

### Layer 2 (follow-up) — packaged distribution: Claude Code plugin + Gemini extension + MCP prompts

Wraps Layer 1's content into installable packages per host — a Claude Code plugin, a Gemini CLI extension, and/or MCP **prompts** (the spec's server-side templated-prompt primitive, distinct from `instructions`) that a client can list and insert on demand. This is the deepest layer because it requires per-host packaging work and, for prompts, a new (read-only, no-auth-impact) MCP capability surface.

### Cross-cutting constraints for all three layers

- **All three layers stay "thin client."** None of them add authorization logic, cache report data, or give the MCP server any capability `/api/v1` doesn't already gate. Layer 1/2 are client-side documentation/packaging; Layer 0 is a static string. This keeps every layer consistent with ADR-003/0051 — onboarding is a *teaching* surface, never a second source of truth.
- **The security invariant is non-negotiable across all layers**: no onboarding artifact (instructions, skill, plugin, prompt) may claim or imply the server can read/mutate another user's or org's data. `/api/v1` remains the sole authorizer (ADR-0059/0060); the MCP forwards the caller's own credential and nothing else (ADR-0051). This PR's `instructions` text is written and tested to this constraint explicitly (see the test list above).
- **Trust tier stays asymmetric (ADR-0069).** The instructions/skill/plugin/prompt content is first-party — authored and reviewed the same way any other source file in this repo is (PR review, this ADR). It is trusted the way our own code is. This is categorically different from a tool's *output* (e.g. the HTML body of a fetched report), which remains untrusted content per ADR-0069/0045/0062 regardless of which onboarding layer surfaced the tool that returned it — an agent must not treat a report's contents as instructions just because a nearby tool description told it how to use the tool.

## Consequences

- **Good**: every client that connects to `arp-mcp` today gets some onboarding signal for zero install cost — CLI-class hosts via `instructions`, all hosts via the sharpened tool descriptions. The highest-value single fact (re-upload same slug ⇒ same URL, new version) is now stated in three places (instructions, the tool description, `docs/mcp-usage.md`) instead of being inferable only from a one-line field description.
- **Good**: `instructions.ts` being a standalone, exported, unit-tested constant means Layer 1/2 can quote or extend it without re-deriving the workflow story from scratch, and a future edit to the wording has one seam to update plus a test that will fail loudly if it drifts into over-claiming language.
- **Trade-off**: `instructions` reaches only a subset of clients today (verified: Claude Code/Gemini/Codex-class yes, Claude Desktop no) — Layer 0 alone does not fully solve onboarding for Desktop; that gap is exactly why Layer 1 (a skill file Desktop-class clients can install directly) is the near-term follow-up, not an alternative.
- **Trade-off**: this ADR intentionally leaves Layer 1/2 as tracked follow-ups rather than specifying their file layout/packaging mechanics in full — each is different enough in scope (a single portable file vs. per-host packaged distributions) to warrant its own implementation PR, and possibly its own amending ADR if the packaging mechanics turn out to need a decision this ADR didn't anticipate.
- **Neutral**: no change to transport, auth, tool schemas, or the `/api/v1` contract — this ADR is additive documentation/instruction content layered on top of the existing ADR-0051 server.

## More information

- `docs/adr/0051-mcp-server.md` — the thin-client/transport/auth decisions this ADR builds onboarding on top of, unchanged.
- `docs/adr/0069-agent-tool-trust-boundary.md` — the trust-tier classification (first-party-authored vs. untrusted tool output) this ADR applies to onboarding content specifically.
- `apps/mcp/src/instructions.ts` — the Layer 0 `INSTRUCTIONS` constant.
- `apps/mcp/src/server.ts` — `buildMcpServer`, wiring `instructions` into the SDK `McpServer`.
- `apps/mcp/src/server.test.ts` — the workflow-coverage + non-over-claiming assertions.
- `apps/mcp/src/tools.ts` — the sharpened `reports_upload`/`folders_create` descriptions.
- `docs/mcp-usage.md` — the human-facing usage doc; now cross-referenced from the "Notes" section as the source `instructions` summarizes.

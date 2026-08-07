# ADR-0082: A layered constitution — a small high-precedence `CLAUDE.md` over on-demand articles

- **Status**: Accepted
- **Date**: 2026-08-07
- **Deciders**: agranado2k
- **Relates to**: ADR-026 (docs-trigger matrix — this restructure is itself doc-work), ADR-0069 (agent trust boundary — compressed into the root, rationale stays in the ADR), ADR-0072 (MCP onboarding layers — the model for `apps/mcp/CLAUDE.md`), ADR-024/ADR-0036 (the style rules moved into the local article). Implements AI-SDLC plan Phase 5.3 (issue #265).

## Context and problem statement

`CLAUDE.md` was a single 110-line file that mixed three unrelated kinds of instruction:

1. **Portable framework rules** — "tests are the target function", "every slice is vertical", "autonomy never includes merge". True of any AI-assisted project.
2. **Project-local engineering rules** — ADR-024's FP style, ADR-0036's bounded contexts, the Terraform wrapper, the dependency policy.
3. **Project-local process elaboration** — the full ADR-0044 merge exposition, the dual-AI-review wiring, the ADR-026 trigger matrix, the diary protocol.

Two problems follow from the mixing, and both are already biting.

**It is not replicable.** The first category is the actual product of the AI-SDLC work — the part a second project would want to adopt — and there was no way to take it without also taking Neon advisory locks and `view.centaurspec.com`. A framework you cannot copy is not a framework.

**It costs on every request.** Root instructions are re-read on every turn of every session, so their cost is paid continuously while their value is occasional. The published AGENTS.md guidance puts a practical working budget around ~150–200 instructions before an agent starts losing precision on the ones that matter; a root that spends 60 lines on the exact GitHub button to click and the history of an obsolete bot-merge flow is spending precedence on things that are true but rarely needed. Worse, several rules already lived in two places at once (TDD conventions in both the root and `.claude/skills/tdd/SKILL.md`) — duplication that will drift, and stale standing instructions actively poison context rather than merely wasting it.

Two independent sources converge on the same shape: SwarmForge's constitution layering (a small high-precedence root over shared and local articles) and the AGENTS.md instruction budget. Claude Code's own loading model already supports it — nested `CLAUDE.md` files load when an agent works in that subtree.

## Decision drivers

- **Replicability** — a future project must be able to copy the portable rules *verbatim*, as a file, with no editing pass.
- **Precedence economy** — what is re-read every request should be the binding minimum; elaboration should be one hop away, not preloaded.
- **One home per rule** — duplication is drift waiting to happen; a rule lives in exactly one place and everything else points at it.
- **Nothing binding may silently disappear** in a restructure — a docs refactor that quietly drops a rule is indistinguishable from a policy change nobody approved.
- **Progressive disclosure, not eager loading** — a mechanism that pulls the articles back into every request would defeat the whole exercise.

## Decision outcome

**Four layers.**

1. **Root `CLAUDE.md` (100 lines, was 110 — 27 of them the load-bearing quick-reference table, kept in full).** The root is short not because the table crowds the prose out — the ~73 prose lines still outweigh it — but because the elaboration moved into the articles; what stayed is the binding minimum. Keeps only: the orientation paragraph (read the diary first, the spec wins), seven hard rules stated in one sentence each (worktree/ADR-025, test-first + the pre-push pairing guard, tracer bullets, ADR-before-infra-or-security, Conventional Commits, the ADR-0044 merge button, `pnpm docs:check`), the trust boundary compressed to one paragraph pointing at ADR-0069, the full intent→command quick-reference table, a pointer block naming each article in one line, and the closing "spec wins".

2. **`.claude/constitution/shared-invariants.md`** — the portable framework. Eleven invariants: specs before code / tickets before sessions; every slice vertical; tests are the target function (and the harness is the ceiling); fresh context per phase with reviewers never seeing implementation history; standards findings → agents, behavior findings → humans, never merged; judgment is HITL by label; autonomy never includes merge; process docs are executable or CI-verified; measure the ceiling (mutation testing, final QA through the UI); refactor-only never shares a commit with behavior change; the context budget is a real budget. **It names no product, vendor, path, or command** — that constraint is what makes "copy it verbatim" a real claim rather than an aspiration.

3. **`.claude/constitution/local-engineering.md`** and **`.claude/constitution/local-workflow.md`** — the centaur-specific elaboration, split by the question being asked. Engineering: FP/immutable style, DDD and the glossary, test tiers, infrastructure, the boundary list. Workflow: commits, the merge policy in full, the pre-push and CI sequence, the ADR-026 matrix, dual AI review, ADR mechanics, the diary protocol.

4. **Nested `apps/mcp/CLAUDE.md` and `packages/domain/CLAUDE.md`** (~25 lines each) — rules that only apply inside one tree, and that Claude Code loads only when an agent works there. The MCP file states that the prompt surface *is* the product surface (ADR-0072's three layers, the `OVERCLAIM_PATTERNS` and skill-sync guards, prompt deltas as Axis-2 confirm-list material). The domain file states purity (no I/O, `readonly`, vanilla TS + `Result`, glossary names) and claims property tests and mutation calibration as its own.

**The root references articles as plain paths, not `@`-imports.** An `@`-import inlines the file into the request, which would reproduce the original 400-line root with extra steps. Progressive disclosure is the entire point.

**The `claude-md-refs` validator now walks the article layer.** `.claude/constitution/*.md` gets the same checks the root gets — slash commands must resolve to a real skill, referenced repo paths must exist — and `.claude/constitution/` was added to the checked path roots so the root's own references to its articles are existence-checked. Without this, the restructure would have moved most of the manual's prose *out* from under the only guard that keeps it honest. Five fixture tests cover it (article with a stale command, article with a dead path, article referenced from the root but missing, articles checked with no root present, and the conformant case).

**Nothing binding was dropped.** Every rule in the old root was traced to exactly one new home; the mapping is in the commit body. Two rules were deliberately *de-duplicated* rather than moved: the TDD conventions (the skill at `.claude/skills/tdd/SKILL.md` is now their only home, with the root keeping the one-line obligation and a pointer) and the "never fetch and execute remote code" boundary (folded into the root's trust-boundary paragraph, where it belongs, and left in the local boundary list only as narrative). One claim was dropped as *false*, not relocated: the header's "ADR-0035–0048 in `docs/adr/`" had been stale since ADR-0049.

## Considered options

- **Leave it as one file and just trim.** Rejected: trimming addresses the budget but not the replicability problem, and the portable rules stay entangled with the local ones. It also has no stable stopping point — the file grew to 110 lines by exactly this route.
- **Split, but with `@`-imports from the root.** Rejected: `@`-imports are eager. The request-time payload would be unchanged (in fact larger), so the budget argument would be satisfied only on paper.
- **Push everything into skills instead of articles.** Rejected: skills are *procedural* — invoked to do a task. Standing rules that constrain all work regardless of task have no invocation point, and burying them in a skill means they apply only when someone happens to run it.
- **Split, but leave the validator checking the root only.** Rejected outright: it converts a CI-verified document into an unverified one by moving text sideways. The rule that process docs are executable or CI-verified would have been violated by the very commit that wrote it down.
- **Also validate the nested `apps/mcp` / `packages/domain` files.** Deferred, not rejected — the same argument applies, but those files reference package-local paths outside the validator's current root list, so it needs its own small design pass. Tracked as a follow-up.

## Consequences

- **Good**: the root's binding content is now readable in under a minute, and the quick-reference table — the highest-traffic thing in the file — is no longer buried under six sections of exposition.
- **Good**: `shared-invariants.md` is a genuine artifact. Copying it into a new repo is a `cp`, and the discipline that keeps it that way (no product names, no paths, no commands) is stated at the top of the file itself.
- **Good**: the article layer is CI-guarded from day one, so it cannot rot the way an unchecked docs directory would.
- **Trade-off**: a rule is now one hop away, and an agent that does not follow the pointer will miss it. This is mitigated by keeping every rule that *must* be obeyed unconditionally in the root, and only elaboration in the articles — but the line between "binding" and "elaboration" is a judgment call, and some of those calls will need revisiting.
- **Trade-off**: four files instead of one means four places to keep current, and the "one home per rule" discipline is enforced by review rather than by a tool. A future validator could check for cross-article duplication; none exists today.
- **Neutral**: `docs/spec.html` remains the contract. This ADR changes how the agent operating manual is *organized*, not what it says.

## More information

- Full analysis: the AI-SDLC report §8.5 (linked from issue #265).
- The instruction-budget framing comes from the published AGENTS.md guidance; the layering shape comes from SwarmForge's constitution model. Both are external references, adapted rather than adopted.
- Phase 5.1 (mutation testing) and 5.2 (property tests) are sibling tracer bullets under the same PRD; §9 and §10 of `shared-invariants.md` are the written form of their conclusions.

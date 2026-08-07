---
name: implement
description: Implement exactly one ticket (or one small spec) in a fresh context — restate it, drive /tdd through the agreed seams, verify, self-review, commit. Use for a ticket produced by /to-tickets, or a small spec that needs no decomposition. Not for unwritten requirements (use /grill-me → /to-prd first).
---

# /implement — one ticket, one fresh session

Build a finalized ticket into committed code. This skill adds **context isolation** on top of the repo's worktree (branch) isolation: one ticket per session, nothing carried over.

## Session contract

1. **Open by restating the ticket** — what will exist when this session ends, in one paragraph, using `docs/domain-glossary.md` names. If you cannot restate it without asking questions, STOP: the ticket is not ready — send it back through `/grill-me` or `/to-tickets`, don't guess.
2. **Check the ground**: you are in a `worktree/<slug>` on a `<type>/<slug>` branch (ADR-025), not the root checkout, and its blockers (the ticket's `Blocked by:` issues) are merged.
3. **Identify the seams** — the public boundaries the behavior is observable through (a use case in `packages/application`, a route module, an MCP tool). Tests go through seams, not internals.
4. **Drive `/tdd` through each seam**: failing test that would fail for a plausible wrong implementation → minimal code → refactor. Frequent typechecks and single-file test runs while iterating; the **full suite once** at the end.
5. **Self-review the diff** before committing: does it deliver the restated behavior, nothing else? One vertical slice per diff — no drive-by refactors (behavior-preserving cleanup is its own commit, or its own ticket).
6. **Commit** with Conventional Commits. The `.husky/pre-push` TDD pairing guard should never fire on you — if it does, you skipped step 4.

## Boundaries

- **One ticket per invocation.** Parallel implement sessions live in separate worktrees or not at all.
- Does **not** open PRs, close tickets, or tick acceptance criteria — report what's done; the operator (or `/pr-iterate`) takes it from there.
- **Token burn is a ticket-sizing signal**: if a session runs long or the context degrades, the ticket was too big — stop, commit the coherent slice you have, and split the remainder via `/to-tickets`, rather than pushing through with degraded judgment.

## The standing tracer-bullet rule

When building features, build a tiny, end-to-end slice first, seek feedback, then expand out from there — never a whole horizontal layer in isolation.

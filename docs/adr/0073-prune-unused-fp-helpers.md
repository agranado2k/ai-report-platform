# ADR-0073: Prune the unused FP helpers — delete `pipe()` and the `Result` combinators

- **Status**: Accepted
- **Date**: 2026-07-28
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-024 (functional programming style, no new libraries — inline in `docs/spec.html`; its core decision stands, one factual claim in it is corrected below).

## Context and problem statement

ADR-024 shipped a 12-line `pipe()` and a `Result<T, E>` with five combinators (`isOk`, `isErr`, `map`, `flatMap`, `unwrapOr`) as the domain's FP toolkit. Two months of real use cases later, the architecture review's "prune the pass-through shelf" candidate asked: which of these does production code actually call? The deletion test (grep across `packages/` and `apps/`) answered:

- **`pipe()`** — zero production callers. The only `pipe` outside the module was React's unrelated `renderToPipeableStream` destructure in `apps/app/app/entry.server.tsx`.
- **`isOk` / `isErr` / `map` / `flatMap` / `unwrapOr`** — zero callers outside `result.test.ts`. Every consumer narrows on the `ok` discriminant directly (`if (!r.ok) return r;`), which TypeScript's control-flow narrowing handles natively.
- **The `Result<T, E>` type + `ok` / `err` constructors** — used pervasively; they are the load-bearing part.

Unused exports are not free: they are surface an agent (or human) must read, a shelf that invites speculative use, and — per ADR-024's own comment in `result.ts` — a source of stale claims about how the code works.

## Decision outcome

Delete `packages/domain/src/pipe.ts` (and its test and index re-export) and the five `Result` combinators (and their tests). Keep the `Result<T, E>` type and the `ok`/`err` constructors.

**Correction to ADR-024** (recorded here per the new-ADR-supersedes convention; `docs/spec.html` is not edited): ADR-024's framing that use cases thread `Result` through `pipe()` never became true — use cases are sequential early-return functions narrowing on `r.ok`. That style is retained deliberately: it is the most legible shape for both agents and humans, and it needs no helper at all.

Everything else in ADR-024 **stands unchanged**: pure functions in domain/application, `readonly` everywhere, side effects pushed to adapters, and **no FP library** (fp-ts / Effect / Ramda remain rejected). This ADR removes dead weight; it does not reopen that decision. If a real combinator need appears later, reintroducing a used helper is a 10-line PR.

## Considered options

- **Keep the helpers "for when we need them"** — rejected: two months of use cases produced zero callers; the shelf documents an intention, not the code.
- **Delete `Result` entirely and throw** — rejected: `Result` is used everywhere and is ADR-024's actual payoff (typed expected-failure paths, no exceptions).
- **Adopt an FP library to make combinators worth using** — rejected, unchanged from ADR-024.

## Consequences

- **Good**: the domain's public surface states only what production uses; grep-for-callers stays an honest signal.
- **Good**: the stale `result.ts` comment ("use cases thread Result through pipe()") is gone; docs match reality.
- **Neutral**: `verifyAccessToken` (a similar thin boolean wrapper) was *kept* — the deletion test found a caller in `packages/application/src/use-cases/resolve-access.test.ts` (a load-bearing sanity assertion in the empty-secret fail-closed test). Its edit-token twin `verifyEditToken` had no callers and was deleted.
- **Trade-off**: a future caller must re-add a combinator instead of importing it — accepted; additions are cheap and reviewed.

## More information

- Same PR: the structurally identical mint/read shells of `access-token.ts` and `edit-token.ts` were extracted into `packages/domain/src/claims-codec.ts` (`makeClaimsCodec({ parseClaims })` → `{ mint, read }`) over the `signed-token.ts` primitives — all existing exports and wire formats preserved; the untouched token test suites are the behavioral lock.
- ADR-024 remains inline in `docs/spec.html` (extraction backlog, `docs/adr/INDEX.md`).

# packages/domain — the pure layer

This package is the reason the rest of the test strategy is cheap. Keep it pure.

1. **No I/O. Ever.** No `fetch`, no filesystem, no database, no clock, no randomness
   reached for directly — a caller passes those in. All I/O lives in
   `packages/adapters/` (ADR-024).
2. **`readonly` on every type**, including nested arrays and object fields. ESLint fails
   the build otherwise.
3. **Vanilla TS + `Result<T, E>`** with `ok`/`err`. No FP library (ADR-024), and no
   reintroducing the `pipe()` / `Result` combinators pruned by ADR-0073.
4. **Glossary names only** (`docs/domain-glossary.md`) — types, functions, tests, and
   assertions. A new term is added to the glossary in the same PR (ADR-0036).
5. **One root entity per aggregate; branded Value Objects; Domain Events at aggregate
   boundaries.** No CQRS, no Event Sourcing (ADR-0036 non-goals).
6. **This is where property tests and mutation calibration live** (issue #265). Purity is
   what makes both affordable: invariants are expressible as properties, and mutation
   runs are fast with no infrastructure. A surviving mutant here is a real gap in the
   target function, not noise — fix the test, not the score.

Tests are `*.test.ts` co-located with source; `pnpm test` from this directory runs them.

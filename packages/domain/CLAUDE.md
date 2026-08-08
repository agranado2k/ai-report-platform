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
   target function, not noise — fix the test, not the score. Two ways to run it, both on
   demand and neither a gate (ADR-0081): `pnpm test:mutation` mutates the whole package
   (~1050 mutants, ~51 s — the calibration), and `scripts/mutation-delta.sh` mutates only
   the source files the current branch changed (seconds), which is the form `/review-pr`
   consumes. Run the differential one before you push a change in this tree.

Tests are `*.test.ts` co-located with source; `pnpm test` from this directory runs them.

Rules 1–5 restate the ADR-024 / ADR-0036 rules from `.claude/constitution/local-engineering.md`
**on purpose** — a nested manual must stand alone, because Claude Code loads this file when
an agent works in this tree without any guarantee the article was read. The article stays
the home for the reasoning; this file is the package-scoped restatement.

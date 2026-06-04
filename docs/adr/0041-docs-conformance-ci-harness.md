# ADR-0041: Documentation-as-contract — CI-enforced conformance harness

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: agranado2k
- **Supersedes / amends**: implements the CI slice of ADR-026 (documentation-as-contract); complements ADR-023 (BDD/Gherkin), ADR-027 (OpenAPI source of truth), ADR-0036 (ubiquitous language).
- **Superseded by**: —

## Context and problem statement

ADR-026 makes documentation a contract and describes three enforcement points: a `/docs-check` skill, a `docs-prepush-guard.sh` pre-push hook, and a CI "feature-or-fail" gate. None existed. In parallel the spec enumerated ~31 BDD use-cases with **zero** `.feature` files, and ADR-027 mandated an OpenAPI source of truth that had not been authored. So the contract could drift — a renamed `ReportVersion`, an ADR with no INDEX row, a route with no OpenAPI entry, a use-case claimed but unbacked — with nothing to catch it. We need to (a) author the missing use-case specs and (b) enforce well-formedness, and decide **where** that enforcement lives. (PRD: GitHub issue #13.)

## Decision drivers

- One authoritative pass/fail signal that gates merge, runnable identically by a contributor locally.
- Minimal dependency surface — the repo had no test runner, and a test-runner choice is itself ADR-weight; we don't want to smuggle one in here.
- The rules must be reviewable (data, not scattered logic).
- Honesty: a use-case the harness counts as "present" must really exist and parse, without implying behavioral completeness.

## Decision outcome

**A dependency-free conformance harness (`scripts/docs-conformance`, plain ESM, tested with Node's built-in `node:test`) run by a single CI workflow (`docs-conformance.yml`) as the enforcement seam. The local pre-push hook and `/docs-check` skill from ADR-026 are deferred.**

- **Seam = CI only.** `pnpm docs:check` is the gate; `.github/workflows/docs-conformance.yml` runs it (and the harness self-tests) on every PR. The runner stays a pure, fast CLI so a future PR can wire the ADR-026 pre-push hook over the same command without refactoring.
- **Zero new dependencies.** The harness uses Node built-ins only; its own tests use `node:test`. This explicitly avoids choosing a project-wide test runner in this PR (that remains a separate decision). OpenAPI validation is **lint-lite** (required-token checks); full Spectral/Redocly schema linting and markdown/link linting are deferred enhancements, logged here so the gap is explicit.
- **Rules live in `config.mjs`** (allowed ADR statuses, required MADR sections, banned aliases, canonical events, the use-case catalog, OpenAPI tokens); validators hold no policy.
- **Seven validators**: ADR-MADR conformance, ADR↔INDEX bijection, glossary banned-alias, canonical-event presence, feature-presence bijection, Gherkin structure, OpenAPI structure.
- **Use-case corpus authored**: 29 `.feature` files. Phase-1 upload/serve use-cases are worked; later-phase ones are valid `@wip` skeletons. Feature-presence asserts existence + parse, never behavioral completeness — `@wip` keeps the catalog honest.

### Consequences

**Positive**: one merge-gating signal; contract drift (naming, ADR registry, events, OpenAPI, orphan/missing features) caught automatically; no new runtime or test-runner dependency; rules reviewable as data.

**Negative**: partial implementation of ADR-026 (no pre-push hook yet) — a contributor only learns of a violation at CI, not at push time. Lint-lite OpenAPI checks can pass a structurally-valid-but-semantically-wrong document until Spectral is added.

**Neutral**: `node:test` is used here without committing the wider codebase to it; that choice stays open.

## Considered options

- **CI-only gate over a dependency-free harness** *(chosen)* — minimal surface, one seam, hook-ready.
- **Full ADR-026 implementation now** (skill + pre-push hook + CI) — more complete but couples this PR to a husky/hook design and a heavier toolchain.
- **Spectral + markdownlint + cucumber from the start** — stronger validation, but adds several dependencies and a test-runner decision this PR shouldn't make.
- **A standalone `/docs-check` skill only** (no CI gate) — lowest friction, but nothing forces it to run.

## More information

- PRD: GitHub issue #13. Harness usage: `scripts/docs-conformance/README.md`.
- Related: ADR-026 (documentation-as-contract), ADR-023 (BDD/Gherkin), ADR-027 (OpenAPI), ADR-0036 (ubiquitous language), ADR-0037..0040 (the upload/serve contract the OpenAPI doc and Phase-1 features encode).
- Follow-ups: wire the ADR-026 pre-push hook over `pnpm docs:check`; add Spectral/Redocly OpenAPI linting and markdown/link linting; revisit a project-wide test runner.

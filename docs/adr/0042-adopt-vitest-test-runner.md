# ADR-0042: Adopt Vitest as the unit/integration test runner

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: agranado2k
- **Supersedes / amends**: resolves the "project-wide test runner" follow-up left open in ADR-0041; supports ADR-022 (strict TDD), ADR-024 (functional domain).
- **Superseded by**: —

## Context and problem statement

Phase 1 is the first real code (`packages/domain`, then `application`, `adapters`). Strict TDD (ADR-022) needs a test runner, and the repo had none — the docs-conformance harness deliberately used Node's built-in `node:test` to avoid imposing a project-wide choice (ADR-0041). That choice can no longer be deferred: the domain is TypeScript with `readonly` types (ADR-024), and `node:test` has no first-class TS support (needs a loader), thin watch/coverage/mocking, and no alignment with the Vite-based Remix apps. We need one runner for all TS packages.

## Decision drivers

- Native TypeScript + ESM execution with no extra transpile step.
- Alignment with the existing stack — `apps/app` / `apps/view` already build on Vite.
- Fast watch mode, coverage, and mocking for the use-case/adapter layers.
- Minimal configuration across a pnpm + Turbo monorepo.

## Decision outcome

**Adopt Vitest as the test runner for all TypeScript packages**, configured at the repo root (`vitest.config.ts`, `include: packages/*/src/**/*.test.ts`), with `pnpm test` → `vitest run` and `pnpm test:watch` → `vitest`. Tests live next to the code as `*.test.ts`.

**Pinned to Vitest 3.x.** Vitest 4 requires Vite 6+, but the Remix v2 apps pin Vite 5.4 (and Remix v2 has not validated Vite 6); a single hoisted Vite is shared across the workspace, so Vitest 4 fails at startup (`vite` has no `./module-runner` export under v5). Vitest 3.x supports Vite 5, so it is the compatible choice until the apps move to Vite 6 — at which point Vitest can be bumped to 4 in a dedicated PR.

**`node:test` is retained only** for the dependency-free docs-conformance harness (`scripts/docs-conformance`, ADR-0041) — it has no Vite/TS needs and benefits from zero dependencies. Everything under `packages/**` uses Vitest.

A `pnpm-lock.yaml` is now committed (the repo previously had none) so installs are deterministic in CI, and a `unit` CI workflow runs `pnpm test` on every PR.

### Consequences

**Positive**: native TS/ESM TDD aligned with the app tooling; one runner, one config; fast feedback; coverage/mocking available for later layers; deterministic installs via the committed lockfile.

**Negative**: pinned a major behind the latest (3.x not 4.x) until the apps adopt Vite 6 — a tracked follow-up. A second test framework (`node:test`) remains in the repo for the doc harness, a small but deliberate inconsistency.

**Neutral**: Vitest pulls its own Vite; no change to the apps' build.

## Considered options

- **Vitest 3.x** *(chosen)* — Vite-native, TS-first, fast; compatible with the apps' Vite 5.
- **node:test** — zero deps (good for the doc harness), but weak TS ergonomics and no Vite alignment; poor fit for the wider TS codebase.
- **Jest** — mature and ubiquitous, but heavier ESM/TS configuration friction in a Vite monorepo and slower; not aligned with the existing stack.
- **Vitest 4.x** — the latest, but incompatible with the apps' Vite 5 today (startup failure); revisit after the apps move to Vite 6.

## More information

- Related: ADR-0041 (left this open; `node:test` retained for the harness), ADR-022 (strict TDD), ADR-024 (functional domain), ADR-0036 (the domain model under test).
- Compatibility note: [Vitest requires Vite — version pairing](https://vitest.dev/guide/) (Vitest 4 ⇒ Vite 6+; Vitest 3 ⇒ Vite 5/6).

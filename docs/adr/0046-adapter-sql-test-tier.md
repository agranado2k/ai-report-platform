# ADR-0046: Two-tier adapter testing — in-process pglite below the Neon e2e tier

- **Status**: Accepted
- **Date**: 2026-06-15
- **Deciders**: agranado2k
- **Supersedes / amends**: clarifies ADR-0019 (infrastructure-first delivery); builds on ADR-0042 (Vitest), ADR-0020 (repository pattern / adapters own I/O).
- **Superseded by**: —

## Context and problem statement

On 2026-06-15 a one-line bug in `DrizzleReportRepository.save()` (`ON CONFLICT DO NOTHING` instead of refreshing `scan_status`) 404'd **every** promoted report on production. CI never caught it: the adapter unit tests are **pure mappers** (no database), and ADR-0019's infrastructure-first mandate leaves real-SQL coverage to the e2e tier against Neon — but the relevant e2e serve assertion could not run cross-origin on preview deployments. So an entire class of bug — Postgres SQL semantics (`ON CONFLICT` clauses, transaction atomicity, cached-column coherence) — had **no fast regression coverage** between "pure mapper unit test" and "full e2e against Neon".

The question this ADR settles: where do adapter-SQL tests belong, and does running them against an embedded Postgres violate ADR-0019's "every PR runs against real infrastructure, no mocks"?

## Decision drivers

- Catch SQL-semantics regressions in the fast inner loop (milliseconds, no network), not only at e2e time.
- Stay faithful to real Postgres behaviour — a SQL mock would not have caught the `ON CONFLICT` bug.
- Don't weaken ADR-0019's infrastructure-first e2e tier.
- Avoid Docker / external services in the unit-test job.

## Considered options

1. **pglite (in-process WASM Postgres) as a fast tier below e2e** — real engine, no network/Docker, millisecond loop; needs a `DbContext` injection seam + a dev-dependency.
2. **Ephemeral Neon branch per test run** — strictly ADR-0019 "real infra", but slow (network per run), needs `NEON_API_KEY` in the unit job, and flakier for the inner loop.
3. **Testcontainers Postgres** — real engine, no Neon coupling, but requires Docker in CI and locally; heavier than pglite.
4. **A SQL/repository mock** — rejected outright: a mock would not reproduce `ON CONFLICT` semantics, so it could not have caught the incident this ADR responds to.

## Decision outcome

Chosen: **option 1 (pglite)**. Adapter SQL is tested at **two tiers**:

1. **Fast tier (this ADR)** — Drizzle adapters run their real SQL against **`@electric-sql/pglite`**, the actual Postgres engine compiled to WASM, in-process. The committed `drizzle/*.sql` migrations are applied to a fresh in-memory database per test (real DDL, including data migrations), via a `DbContext` injection seam. This is a **dev-dependency of `packages/adapters`** and runs inside the normal Vitest unit job.

2. **Infrastructure-first tier (ADR-0019, unchanged)** — e2e tests run against the real provisioned Neon database and the rest of the live stack on every PR.

**pglite is not a mock.** It is the genuine Postgres query planner and executor, so `ON CONFLICT … DO UPDATE`, transaction commit/rollback, and enum/constraint behaviour match production. ADR-0019's "no mocks for external services" stands: the fast tier adds *real-engine* coverage below e2e; it does not replace the Neon tier, and it is not a stub. Where pglite's fidelity is insufficient (e.g. pg-boss's runtime-partitioned `ScanWorkQueue`), those adapters stay covered only by the e2e tier.

## Consequences

- A regression test for the 2026-06-15 incident now exists and was verified to **fail** when `save()` is reverted to `ON CONFLICT DO NOTHING`.
- The unit job gains ~0.7–2.7s per integration test (per-test migrate). A shared migrated-template optimisation is a possible future refinement.
- Adding the pglite peer forks `drizzle-orm` into a second pnpm peer-variant; a plain `pnpm install` re-dedupes dependents to one resolved instance (lockfile committed).

## More information

Implemented in `packages/adapters/src/testing/pglite.ts` (`makeTestDb()` / `seedIdentity()` / `sampleReport()`). Covers the report repository, idempotency store, event outbox, scan-queue, and `UnitOfWork` commit-last atomicity (ADR-0037 §5). Tracked by GitHub issue #52.

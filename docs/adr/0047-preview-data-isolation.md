# ADR-0047: Per-PR preview data isolation (soft) — ephemeral Neon branch + R2 key prefix

- **Status**: Accepted
- **Date**: 2026-06-15
- **Deciders**: agranado2k
- **Supersedes / amends**: builds on ADR-0031 (single Neon branch / no staging), ADR-0017 (everything-as-code), ADR-0019 (infrastructure-first). Uses the per-PR Neon-branch pattern from the migration-check workflow.
- **Superseded by**: —

## Context and problem statement

Every Vercel preview deployment (one per PR push, for both `arp-app-prod` and `arp-view-prod`) reads and writes the **production** Neon database and the **production** R2 bucket — `DATABASE_URL`, `R2_BUCKET`, and the R2 credentials are provisioned with `target = ["production","preview"]`. So every PR's e2e smoke writes real rows + blobs into prod (hence the unique-marker hermeticity hack), prod accumulates CI junk, and a buggy feature-branch preview can corrupt production data with ordinary app writes. This preview↔prod entanglement made the 2026-06-15 viewer-404 incident harder to diagnose.

We want each PR's preview to use its own throwaway data plane, without standing up new infrastructure (ADR-0017) and reusing what the migration-check workflow already does (fork an ephemeral Neon branch per PR).

## Decision drivers

- Stop preview app-writes from reaching the production database.
- Reuse the existing per-PR Neon-branch machinery; no new services.
- Don't break preview deploys or require an invasive rework of Vercel's git-driven deploy trigger.
- Keep destructive teardown tightly scoped (never touch prod keys/branch).

## Considered options

1. **Soft isolation** — keep prod `DATABASE_URL`/R2 as the preview fallback; a GitHub Action forks a per-PR Neon branch, injects a git-branch-scoped `DATABASE_URL` + `R2_KEY_PREFIX=pr-<N>/` on both Vercel projects, then redeploys. No deploy-trigger rework, no failed builds.
2. **Hard isolation** — remove the prod env from previews and suppress Vercel's auto-build until the Action has injected the branch env (Action owns the deploy). Guarantees previews never touch prod, but reworks the deploy trigger and produces a failed transient build if anything races.
3. **Neon's native Vercel integration** — auto-branch per preview. Lowest maintenance but a dashboard integration install (ADR-0017 tension) and env managed outside our config.

## Decision outcome

Chosen: **option 1 (soft isolation)** (operator decision). A `preview-isolation` GitHub Actions workflow:

- **On PR open/sync/reopen** — create-or-reuse a `preview-pr-<N>` Neon branch forked from prod head (data persists across pushes within a PR), fetch its pooled connection URI (masked), upsert a **git-branch-scoped** Vercel env on both projects (`DATABASE_URL`, `SCAN_QUEUE_DATABASE_URL`, `R2_KEY_PREFIX=pr-<N>/`), then trigger a redeploy so the isolated env takes effect.
- **On PR close** — delete the Neon branch, remove the branch-scoped env vars, and delete R2 objects under `pr-<N>/` (tightly scoped — never prod keys).

**Safeguard for the soft model:** the workflow **fails loud** (a red PR check) if branch creation or env injection fails, so a fallback-to-prod is *surfaced*, never silent. The R2 key-prefix capability ships separately (ADR-0046-style additive code) and is consumed via the injected `R2_KEY_PREFIX`.

## Consequences

- **Accepted residual:** a preview built *before* the workflow finishes uses the prod fallback (`DATABASE_URL`/no prefix) for that one build; the redeploy then switches it to the isolated branch. Isolation is best-effort + fail-loud, not a hard guarantee. The DB branch is the primary isolation boundary; R2 stays namespaced *within* the prod bucket (`pr-<N>/`), not a separate bucket.
- Requires a `VERCEL_TOKEN` repo secret with team env-management scope (reused from the Terraform provider token).
- Previews stop accumulating rows in the prod database; the e2e's unique-marker hack can be revisited once this is proven.

**Amended 2026-07-09 (issue #149):** the accepted residual above was an *observed* reliability bug, not just a theoretical race — `e2e.yml`'s `deployment_status` gate can't tell the pre-isolation build apart from the isolated redeploy (both fire `state: success` for the same commit), so the smoke intermittently ran against the pre-isolation deployment and 500'd on the DB-writing upload step (writing to prod in the process). The residual is now **gated, not just documented**:

- `preview-isolation.yml`'s `set_env` loop injects an explicit `NEON_BRANCH` marker (the same `preview-pr-<N>` name already computed for the Neon branch itself) alongside `DATABASE_URL`/`R2_KEY_PREFIX` — unset on prod and on the pre-isolation build.
- `/health` (`apps/app/app/routes/health.tsx`) echoes `isolated: Boolean(NEON_BRANCH || R2_KEY_PREFIX)` and `neonBranch`, plus a fail-soft DB ping (`checks.neon: "ok" | "error"`, never a 500 — see `apps/app/app/server/health.server.ts`).
- `e2e.yml` polls `/health` on its own `target_url` before running scenarios: `isolated:true` + `checks.neon:"ok"` → proceed; never isolated within the poll window → this is the pre-isolation deployment, skip cleanly (not a failure); isolated but never DB-ready → fail loud (this deployment is genuinely broken). A `concurrency` group keyed on the deployment sha cancels a still-running pre-isolation invocation once the isolated redeploy's event arrives.

So the two-deployments-per-commit shape (and the soft-fallback window) are unchanged — this amendment closes the *smoke reliability* consequence of that shape, not the isolation model itself.

## More information

Implemented in `.github/workflows/preview-isolation.yml`; consumes the `R2_KEY_PREFIX` plumbing in `R2BlobStore` / the env contract. Tracked by GitHub issue #53.

The Clerk dimension of preview isolation — previously deferred here to the real-auth track (#54) — is now resolved by **ADR-0048**: Vercel `preview` deploys are provisioned with the **staging/test** Clerk instance keys, while `production` keeps the live keys (split by Vercel `target` in `envs/prod/main.tf`). So a preview can never authenticate against the production Clerk user pool. This supersedes the "deferred" note above.

The readiness-gate amendment (2026-07-09) is implemented in `apps/app/app/routes/health.tsx` / `apps/app/app/server/health.server.ts` / `.github/workflows/e2e.yml` / `.github/workflows/preview-isolation.yml` (`NEON_BRANCH`). Tracked by GitHub issue #149.

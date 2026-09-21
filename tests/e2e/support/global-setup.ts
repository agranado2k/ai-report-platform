// Playwright GLOBAL SETUP — runs once, in the top-level process, before any
// worker starts (playwright.config.ts).
//
// Three jobs (issue #266, then #372):
//
//  1. Start from a clean fixture ledger, so this run's global teardown deletes
//     only this run's objects.
//  2. Sweep run-scoped identities off the shared Clerk dev instance. Litter
//     from a job that was cancelled or killed leaves NO teardown behind at all,
//     so it can only ever be collected by somebody else's run — this is that
//     somebody. Doing it at setup (rather than only at teardown) means a run
//     about to provision members first makes room for them.
//
//     The age gate (issue #372): normally this only takes identities older than
//     SWEEP_MIN_AGE_HOURS, because simultaneous PR runs share this instance and
//     an un-gated sweep would delete a CONCURRENT run's live fixtures. But in
//     the serialized-CI smoke — the `preview-smoke-shared` concurrency group,
//     `cancel-in-progress: false` — no other smoke can run at the same time, so
//     the gate protects nothing and instead lets an EVICTED/killed run's
//     younger-than-24h stragglers survive into this run and tip the cap → 402.
//     There we sweep at age 0 (E2E_SERIALIZED_SWEEP=1, set by e2e.yml). See
//     `preRunSweepAgeHours`.
//  3. Fail-fast preflight: after the sweep, confirm the anchored org has
//     headroom for the smoke's footprint. A confirmed shortfall throws HERE,
//     as an obvious setup failure, instead of a confusing mid-suite 402.
//
// Jobs (1) and (2) are never fatal — the sweep is hygiene, the smoke is the
// check. Job (3) IS meant to fail the setup, but only on a CONFIRMED shortfall.

import {
  ANCHORED_TEAM_ORG_ID,
  preRunSweepAgeHours,
  SMOKE_RUN_SCOPED_FOOTPRINT,
} from "./clerk-fixture-identity";
import { resetProvisionedIdentities } from "./clerk-fixture-registry";
import {
  configuredNeverSweep,
  preflightAnchoredOrgCap,
  reportCleanup,
  sweepStaleRunScopedIdentities,
} from "./clerk-fixture-sweep";

export default async function globalSetup(): Promise<void> {
  resetProvisionedIdentities();

  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  // Same gate as every other Clerk-touching fixture: no key, nothing to sweep,
  // and a local `pnpm e2e` stays entirely offline here.
  if (!secretKey) return;

  // Only the serialized-CI smoke may sweep at age 0 (see the header note and
  // preRunSweepAgeHours). e2e.yml sets this on the one job the
  // `preview-smoke-shared` group serializes; unset everywhere else keeps the
  // concurrency-safe default, so a local/dev run can never nuke a live run.
  const serializedSmoke = process.env.E2E_SERIALIZED_SWEEP === "1";

  try {
    const summary = await sweepStaleRunScopedIdentities(secretKey, {
      olderThanHours: preRunSweepAgeHours(serializedSmoke),
      neverSweep: configuredNeverSweep(),
    });
    reportCleanup("clerk pre-run sweep", summary);
  } catch (error) {
    console.warn(
      `clerk pre-run sweep skipped — ${String(error)}. Stale run-scoped identities may still be ` +
        "consuming the shared org's membership cap; run the `Clerk dev-instance sweep` workflow.",
    );
  }

  // After the sweep, fail fast if the org still lacks headroom (issue #372).
  // Throws only on a CONFIRMED shortfall — an undeterminable cap state proceeds.
  await preflightAnchoredOrgCap(secretKey, ANCHORED_TEAM_ORG_ID, SMOKE_RUN_SCOPED_FOOTPRINT);
}

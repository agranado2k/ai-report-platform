// Playwright GLOBAL SETUP — runs once, in the top-level process, before any
// worker starts (playwright.config.ts).
//
// Two jobs, both about issue #266:
//
//  1. Start from a clean fixture ledger, so this run's global teardown deletes
//     only this run's objects.
//  2. Opportunistically sweep run-scoped identities older than
//     SWEEP_MIN_AGE_HOURS off the shared Clerk dev instance. Litter from a job
//     that was cancelled or killed leaves NO teardown behind at all, so it can
//     only ever be collected by somebody else's run — this is that somebody.
//     Doing it at setup (rather than only at teardown) means a run that is
//     about to provision three identities first makes room for them.
//
// Never fatal. A sweep failure must not fail a smoke run: the sweep is
// hygiene, the smoke is the check. Errors are warnings with a pointer to the
// manual workflow.

import { resetProvisionedIdentities } from "./clerk-fixture-registry";
import {
  configuredNeverSweep,
  reportCleanup,
  sweepStaleRunScopedIdentities,
} from "./clerk-fixture-sweep";

export default async function globalSetup(): Promise<void> {
  resetProvisionedIdentities();

  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  // Same gate as every other Clerk-touching fixture: no key, nothing to sweep,
  // and a local `pnpm e2e` stays entirely offline here.
  if (!secretKey) return;

  try {
    const summary = await sweepStaleRunScopedIdentities(secretKey, {
      neverSweep: configuredNeverSweep(),
    });
    reportCleanup("clerk pre-run sweep", summary);
  } catch (error) {
    console.warn(
      `clerk pre-run sweep skipped — ${String(error)}. Stale run-scoped identities may still be ` +
        "consuming the shared org's membership cap; run the `Clerk dev-instance sweep` workflow.",
    );
  }
}

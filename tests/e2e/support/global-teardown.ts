// Playwright GLOBAL TEARDOWN — runs once, in the top-level process, after all
// workers have finished, whatever the run's result (playwright.config.ts).
//
// THIS IS THE DURABLE HALF OF THE ISSUE #266 FIX. The per-scenario
// `After({ tags: "@run-scoped" })` hooks stay as they are — they clean up
// promptly and they know about app-side data (folders) that BAPI does not. But
// they can only ever delete what a step managed to assign to a module
// variable, and the failures that matter (a 402 mid-`ensureTeamFixtureUser`, a
// 429, a worker that died) all happen before that assignment. This teardown
// deletes from the on-disk ledger instead, which is written the instant each
// remote object comes into existence.
//
// Then it repeats the opportunistic age-gated sweep, so a run that leaked
// earlier objects — or that ran alongside a job which crashed — still leaves
// the instance tidier than it found it.
//
// Nothing here throws or fails the run: at this point the verdict is already
// decided, and turning a green suite red over cleanup would just teach everyone
// to ignore it. What it does do is say loudly what it could not delete.
import {
  configuredNeverSweep,
  purgeRegisteredIdentities,
  reportCleanup,
  sweepStaleRunScopedIdentities,
} from "./clerk-fixture-sweep";

export default async function globalTeardown(): Promise<void> {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  if (!secretKey) return;

  try {
    reportCleanup("clerk run teardown", await purgeRegisteredIdentities(secretKey));
  } catch (error) {
    console.warn(`clerk run teardown failed — ${String(error)}`);
  }

  try {
    const summary = await sweepStaleRunScopedIdentities(secretKey, {
      neverSweep: configuredNeverSweep(),
    });
    reportCleanup("clerk post-run sweep", summary);
  } catch (error) {
    console.warn(`clerk post-run sweep skipped — ${String(error)}`);
  }
}

/**
 * Local, human-invoked sweep of leaked run-scoped Clerk fixtures — the CLI
 * twin of `.github/workflows/clerk-sweep.yml`, for the bootstrap case where
 * that workflow cannot run yet (a new workflow_dispatch file is only
 * registered from the default branch, and the leak itself blocks merging).
 *
 *   Dry run (default — lists, deletes NOTHING):
 *     npx --yes tsx@4.20.3 tests/e2e/support/clerk-sweep-cli.ts
 *   Real deletion, all run-scoped regardless of age:
 *     npx --yes tsx@4.20.3 tests/e2e/support/clerk-sweep-cli.ts --apply --older-than-hours=0
 *
 * Secret: E2E_CLERK_SECRET_KEY (or CLERK_SECRET_KEY_STAGING) in the
 * environment — the DEV instance key, never the live one.
 */
import {
  selectSweepableOrganizations,
  selectSweepableUsers,
} from "./clerk-fixture-identity.ts";
import {
  configuredNeverSweep,
  listAllOrganizations,
  listAllUsers,
  reportCleanup,
  sweepStaleRunScopedIdentities,
} from "./clerk-fixture-sweep.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const hoursArg = args.find((a) => a.startsWith("--older-than-hours="));
const olderThanHours = hoursArg ? Number(hoursArg.split("=")[1]) : 0;

const secretKey = process.env.E2E_CLERK_SECRET_KEY ?? process.env.CLERK_SECRET_KEY_STAGING;
if (!secretKey) {
  console.error(
    "No E2E_CLERK_SECRET_KEY / CLERK_SECRET_KEY_STAGING in the environment — refusing to guess.",
  );
  process.exit(2);
}
if (Number.isNaN(olderThanHours) || olderThanHours < 0) {
  console.error(`--older-than-hours must be a non-negative number, got: ${hoursArg}`);
  process.exit(2);
}

const sweepWindow = {
  nowMs: Date.now(),
  olderThanHours,
  neverSweep: configuredNeverSweep(),
};

const users = selectSweepableUsers(await listAllUsers(secretKey), sweepWindow);
const organizations = selectSweepableOrganizations(
  await listAllOrganizations(secretKey),
  sweepWindow,
);

console.log(`run-scoped users matched:         ${users.length}`);
for (const u of users) console.log(`  user ${u.id}  ${u.email ?? "(no email)"}`);
console.log(`run-scoped decoy orgs matched:    ${organizations.length}`);
for (const o of organizations) console.log(`  org  ${o.id}  ${o.name ?? "(no name)"}`);

if (!apply) {
  console.log("\nDRY RUN — nothing deleted. Re-run with --apply to delete the above.");
  process.exit(0);
}

const summary = await sweepStaleRunScopedIdentities(secretKey, { olderThanHours });
reportCleanup("clerk-sweep-cli", summary);

// Runs the shared IdentityStore contract (arp-application/testing) against
// DrizzleIdentityStore on pglite (ADR-0046) — the same suite that runs against
// InMemoryIdentityStore in packages/application/src/testing/contracts/
// identity-store.contract.test.ts. Schema-level assertions (partial unique
// Root-folder index, orgs.kind column) remain covered by
// identity-store.integration.test.ts.
import { describeIdentityStoreContract } from "arp-application/testing";
import { DrizzleIdentityStore } from "./identity-store";
import { makeTestDb } from "./testing/pglite";

describeIdentityStoreContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  return {
    store: new DrizzleIdentityStore(tdb.ctx),
    teardown: () => tdb.close(),
  };
});

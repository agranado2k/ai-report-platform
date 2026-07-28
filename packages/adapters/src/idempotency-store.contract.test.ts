// Runs the shared IdempotencyStore contract (arp-application/testing) against
// DrizzleIdempotencyStore on pglite (ADR-0046, ADR-0039) — the same suite that
// runs against InMemoryIdempotencyStore in packages/application/src/testing/
// contracts/idempotency-store.contract.test.ts.
import { describeIdempotencyStoreContract } from "arp-application/testing";
import { DrizzleIdempotencyStore } from "./idempotency-store";
import { makeTestDb, seedIdentity } from "./testing/pglite";

describeIdempotencyStoreContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx);
  return {
    store: new DrizzleIdempotencyStore(tdb.ctx),
    actingUserId: ids.userId,
    teardown: () => tdb.close(),
  };
});

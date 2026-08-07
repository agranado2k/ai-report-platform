// Runs the shared IdempotencyStore contract (arp-application/testing) against
// DrizzleIdempotencyStore on pglite (ADR-0046, ADR-0039) — the same suite that
// runs against InMemoryIdempotencyStore in packages/application/src/testing/
// contracts/idempotency-store.contract.test.ts.
import { describeIdempotencyStoreContract } from "arp-application/testing";
import { idempotencyKeys } from "arp-db/schema";
import { and, eq, sql } from "drizzle-orm";
import { DrizzleIdempotencyStore } from "./idempotency-store";
import { makeTestDb, seedIdentity } from "./testing/pglite";

describeIdempotencyStoreContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx);
  return {
    store: new DrizzleIdempotencyStore(tdb.ctx),
    actingUserId: ids.userId,
    // Backdate the stored row — the only way to cross the window without
    // waiting a day. The fake rewrites its in-memory stamp instead.
    async expire(ref) {
      await tdb.ctx
        .current()
        .update(idempotencyKeys)
        .set({ createdAt: sql`now() - interval '25 hours'` })
        .where(
          and(
            eq(idempotencyKeys.actingUserId, ref.actingUserId),
            eq(idempotencyKeys.route, ref.route),
            eq(idempotencyKeys.key, ref.key),
          ),
        );
    },
    teardown: () => tdb.close(),
  };
});

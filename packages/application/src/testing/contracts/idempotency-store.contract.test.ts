// Runs the shared IdempotencyStore contract against InMemoryIdempotencyStore.
// The same suite also runs against DrizzleIdempotencyStore on pglite from
// packages/adapters/src/idempotency-store.contract.test.ts (ADR-0046, ADR-0039).
import { userId } from "arp-domain";
import { IDEMPOTENCY_TTL_MS, InMemoryIdempotencyStore } from "../in-memory";
import { describeIdempotencyStoreContract } from "./idempotency-store.contract";

describeIdempotencyStoreContract("in-memory", async () => {
  const store = new InMemoryIdempotencyStore();
  return {
    store,
    actingUserId: userId("00000000-0000-4000-8000-000000000002"),
    // The fake ages a record by rewriting its stamp; the adapter backdates the
    // row. Same contract, two mechanisms — which is the point of the hook.
    async expire(ref) {
      store.ageForTest(ref, IDEMPOTENCY_TTL_MS + 60_000);
    },
    async teardown() {},
  };
});

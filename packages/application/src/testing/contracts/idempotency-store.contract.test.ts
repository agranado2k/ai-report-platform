// Runs the shared IdempotencyStore contract against InMemoryIdempotencyStore.
// The same suite also runs against DrizzleIdempotencyStore on pglite from
// packages/adapters/src/idempotency-store.contract.test.ts (ADR-0046, ADR-0039).
import { userId } from "arp-domain";
import { InMemoryIdempotencyStore } from "../in-memory";
import { describeIdempotencyStoreContract } from "./idempotency-store.contract";

describeIdempotencyStoreContract("in-memory", async () => ({
  store: new InMemoryIdempotencyStore(),
  actingUserId: userId("00000000-0000-4000-8000-000000000002"),
  async teardown() {},
}));

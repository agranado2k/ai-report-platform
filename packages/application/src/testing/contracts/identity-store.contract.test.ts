// Runs the shared IdentityStore contract against InMemoryIdentityStore.
// The same suite also runs against DrizzleIdentityStore on pglite from
// packages/adapters/src/identity-store.contract.test.ts (ADR-0046).
import { InMemoryIdentityStore } from "../in-memory";
import { describeIdentityStoreContract } from "./identity-store.contract";

describeIdentityStoreContract("in-memory", async () => ({
  store: new InMemoryIdentityStore(),
  async teardown() {},
}));

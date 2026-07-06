// Runs the shared GrantStore contract against InMemoryGrantStore. The same
// suite also runs against DrizzleGrantStore on pglite from
// packages/adapters/src/grant-store.contract.test.ts (ADR-0056, ADR-0046).
import { reportId } from "arp-domain";
import { InMemoryGrantStore } from "../in-memory";
import { describeGrantStoreContract } from "./grant-store.contract";

const REPORT_ID = reportId("contract-report");

describeGrantStoreContract("in-memory", async () => ({
  // Real wall-clock time — mirrors the real adapter, which compares grants
  // against `new Date()` at call time (not an injected Clock).
  store: new InMemoryGrantStore({ now: () => Date.now() }),
  reportId: REPORT_ID,
  async teardown() {},
}));

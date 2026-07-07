// Runs the shared WriteGrantStore contract against InMemoryWriteGrantStore. The
// same suite also runs against DrizzleWriteGrantStore on pglite from
// packages/adapters/src/write-grant-store.contract.test.ts (ADR-0060, ADR-0046).
import { reportId, userId } from "arp-domain";
import { InMemoryWriteGrantStore } from "../in-memory";
import { describeWriteGrantStoreContract } from "./write-grant-store.contract";

const REPORT_ID = reportId("contract-report");
const EXISTING_USER_ID = userId("contract-owner");

describeWriteGrantStoreContract("in-memory", async () => ({
  store: new InMemoryWriteGrantStore(),
  reportId: REPORT_ID,
  existingUserId: EXISTING_USER_ID,
  async teardown() {},
}));

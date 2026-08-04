// Runs the shared OrgWriteGrantStore contract against InMemoryOrgWriteGrantStore.
// The same suite also runs against DrizzleOrgWriteGrantStore on pglite from
// packages/adapters/src/org-write-grant-store.contract.test.ts (ADR-0078,
// ADR-0046) — `find` backs an authorization decision, so the two must agree.
import { orgId, reportId, userId } from "arp-domain";
import { InMemoryOrgWriteGrantStore } from "../in-memory";
import { describeOrgWriteGrantStoreContract } from "./org-write-grant-store.contract";

describeOrgWriteGrantStoreContract("in-memory", async () => ({
  store: new InMemoryOrgWriteGrantStore(),
  reportId: reportId("contract-report"),
  otherReportId: reportId("contract-report-2"),
  orgId: orgId("contract-org"),
  existingUserId: userId("contract-owner"),
  async teardown() {},
}));

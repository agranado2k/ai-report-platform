// Runs the shared OrgWriteGrantStore contract (arp-application/testing) against
// DrizzleOrgWriteGrantStore on pglite (ADR-0078, ADR-0046) — the same suite
// that runs against InMemoryOrgWriteGrantStore in packages/application/src/
// testing/contracts/org-write-grant-store.contract.test.ts. `find` backs the
// third leg of the canWrite authorization decision, so the two implementations
// disagreeing would be an authorization bug, not a fixture detail.
//
// `report_id`, `org_id` and `granted_by` are all real FKs, so a Report row (and
// its org / owner user) is saved first — two reports, since the contract proves
// a grant does not leak between them.
import { describeOrgWriteGrantStoreContract } from "arp-application/testing";
import { reportId, versionId } from "arp-domain";
import { DrizzleOrgWriteGrantStore } from "./org-write-grant-store";
import { DrizzleReportRepository } from "./report-repository";
import { makeSampleReport, makeTestDb, seedIdentity } from "./testing/pglite";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const RID2 = reportId("00000000-0000-4000-8000-0000000000a2");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");
const VID2 = versionId("00000000-0000-4000-8000-0000000000b2");

describeOrgWriteGrantStoreContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx);
  const reports = new DrizzleReportRepository(tdb.ctx);
  await reports.save(makeSampleReport({ id: RID, versionId: VID, slug: "abcde12345" }).report);
  await reports.save(makeSampleReport({ id: RID2, versionId: VID2, slug: "fghij67890" }).report);

  return {
    store: new DrizzleOrgWriteGrantStore(tdb.ctx),
    reportId: RID,
    otherReportId: RID2,
    orgId: ids.orgId,
    existingUserId: ids.userId,
    async teardown() {
      await tdb.close();
    },
  };
});

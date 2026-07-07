// Runs the shared setAcl grant-pruning contract (arp-application/testing,
// issue #137, ADR-0056 "5e") against DrizzleGrantStore + DrizzleReportRepository
// on pglite — the same suite that runs against the in-memory fakes in
// packages/application/src/testing/contracts/set-acl-grant-pruning.contract.test.ts.
// `report_grants.report_id` is a real FK, so a Report row is saved first
// (mirrors grant-store.contract.test.ts).
import { describeSetAclGrantPruningContract, FakePasswordHasher } from "arp-application/testing";
import { createReport, makeSlug, reportId, versionId } from "arp-domain";
import { DrizzleGrantStore } from "./grant-store";
import { DrizzleReportRepository } from "./report-repository";
import { makeTestDb, seedIdentity } from "./testing/pglite";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");

describeSetAclGrantPruningContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx);
  const slug = makeSlug("gp00000002");
  if (!slug.ok) throw new Error("bad contract-test slug");
  const reports = new DrizzleReportRepository(tdb.ctx);
  await reports.save(
    createReport({
      id: RID,
      orgId: ids.orgId,
      folderId: ids.folderId,
      slug: slug.value,
      title: "T",
      versionId: VID,
      contentHash: "a".repeat(64),
      uploadedBy: ids.userId,
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 1,
    }).report,
  );

  return {
    reports,
    grants: new DrizzleGrantStore(tdb.ctx),
    hasher: new FakePasswordHasher(),
    orgId: ids.orgId,
    userId: ids.userId,
    reportId: RID,
    slug: slug.value,
    async teardown() {
      await tdb.close();
    },
  };
});

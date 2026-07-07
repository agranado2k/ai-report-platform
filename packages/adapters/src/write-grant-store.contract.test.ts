// Runs the shared WriteGrantStore contract (arp-application/testing) against
// DrizzleWriteGrantStore on pglite (ADR-0060, ADR-0046) — the same suite that
// runs against InMemoryWriteGrantStore in packages/application/src/testing/
// contracts/write-grant-store.contract.test.ts. `report_write_grants.report_id`
// is a real FK, so a Report row (and its owner user) is saved first.
import { describeWriteGrantStoreContract } from "arp-application/testing";
import { createReport, makeSlug, reportId, versionId } from "arp-domain";
import { DrizzleReportRepository } from "./report-repository";
import { makeTestDb, seedIdentity } from "./testing/pglite";
import { DrizzleWriteGrantStore } from "./write-grant-store";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");

describeWriteGrantStoreContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx);
  const slug = makeSlug("abcde12345");
  if (!slug.ok) throw new Error("bad slug");
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
    store: new DrizzleWriteGrantStore(tdb.ctx),
    reportId: RID,
    existingUserId: ids.userId,
    async teardown() {
      await tdb.close();
    },
  };
});

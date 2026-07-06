// Runs the shared GrantStore contract (arp-application/testing) against
// DrizzleGrantStore on pglite (ADR-0056, ADR-0046) — the same suite that runs
// against InMemoryGrantStore in packages/application/src/testing/contracts/
// grant-store.contract.test.ts. `report_grants.report_id` is a real FK, so a
// Report row is saved first (mirrors grant-store.integration.test.ts).
import { describeGrantStoreContract } from "arp-application/testing";
import { createReport, makeSlug, reportId, versionId } from "arp-domain";
import { DrizzleGrantStore } from "./grant-store";
import { DrizzleReportRepository } from "./report-repository";
import { makeTestDb, seedIdentity } from "./testing/pglite";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");

describeGrantStoreContract("drizzle+pglite", async () => {
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
    store: new DrizzleGrantStore(tdb.ctx),
    reportId: RID,
    async teardown() {
      await tdb.close();
    },
  };
});

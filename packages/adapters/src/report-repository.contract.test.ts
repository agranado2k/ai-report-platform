// Runs the shared ReportRepository contract (arp-application/testing) against
// DrizzleReportRepository on pglite (ADR-0046) — the same suite that runs
// against InMemoryReportRepository in packages/application/src/testing/
// contracts/report-repository.contract.test.ts. A fresh migrated db is seeded
// per test (matches the other *.integration.test.ts files in this package).
import { describeReportRepositoryContract } from "arp-application/testing";
import { createReport, makeSlug, reportId, versionId } from "arp-domain";
import { DrizzleReportRepository } from "./report-repository";
import { makeTestDb, seedIdentity } from "./testing/pglite";

function slugFor(n: number): string {
  return `rc${n.toString().padStart(8, "0")}`; // 10 chars, nanoid alphabet
}

/** A deterministic UUIDv7-shaped id, distinct from seedIdentity()'s fixed
 *  constants and monotonically increasing with `n` (the real Postgres `uuid`
 *  column requires valid UUID text). */
function reportIdFixture(n: number) {
  return reportId(`10000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`);
}

function versionIdFixture(n: number) {
  return versionId(`20000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`);
}

describeReportRepositoryContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx);
  const repo = new DrizzleReportRepository(tdb.ctx);
  let seq = 0;
  let versionSeq = 0;

  return {
    repo,
    orgId: ids.orgId,
    nextVersionId() {
      versionSeq += 1;
      return versionId(`30000000-0000-4000-8000-${versionSeq.toString(16).padStart(12, "0")}`);
    },
    makeReport(overrides = {}) {
      seq += 1;
      const slugStr = overrides.slug ?? slugFor(seq);
      const slug = makeSlug(slugStr);
      if (!slug.ok) throw new Error(`bad contract-test slug: ${slugStr}`);
      return createReport({
        id: overrides.id ?? reportIdFixture(seq),
        orgId: ids.orgId,
        folderId: ids.folderId,
        slug: slug.value,
        title: overrides.title ?? `Report ${seq}`,
        versionId: versionIdFixture(seq),
        contentHash: "a".repeat(64),
        uploadedBy: ids.userId,
        manifest: { entryDocument: "index.html", files: ["index.html"] },
        sizeBytes: 11,
      }).report;
    },
    async teardown() {
      await tdb.close();
    },
  };
});

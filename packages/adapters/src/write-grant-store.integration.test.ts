// Integration tests for DrizzleWriteGrantStore against real Postgres (pglite) —
// per-report write grants (ADR-0060). A report is seeded first (the
// report_write_grants.report_id FK), then grant/revoke/listByReport/findFor are
// exercised directly (the shared contract suite already covers the behavior
// that must agree with the fake; this file adds Drizzle-specific coverage,
// mirroring grant-store.integration.test.ts).
import { reports } from "arp-db/schema";
import { createReport, makeSlug, reportId, userId, versionId } from "arp-domain";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleReportRepository } from "./report-repository";
import { makeTestDb, type SeededIdentity, seedIdentity, type TestDb } from "./testing/pglite";
import { DrizzleWriteGrantStore } from "./write-grant-store";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");
const STRANGER = userId("00000000-0000-7000-8000-00000000dead");

describe("DrizzleWriteGrantStore (pglite integration, ADR-0060)", () => {
  let tdb: TestDb;
  let store: DrizzleWriteGrantStore;
  let ids: SeededIdentity;

  beforeEach(async () => {
    tdb = await makeTestDb();
    ids = await seedIdentity(tdb.ctx);
    const slug = makeSlug("abcde12345");
    if (!slug.ok) throw new Error("bad slug");
    const repo = new DrizzleReportRepository(tdb.ctx);
    await repo.save(
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
    store = new DrizzleWriteGrantStore(tdb.ctx);
  });
  afterEach(() => tdb.close());

  it("persists grantedBy and a null granteeUserId", async () => {
    await store.grant(RID, "a@b.com", ids.userId, null);
    const found = await store.findFor(RID, { userId: STRANGER, email: "a@b.com" });
    expect(found.ok && found.value?.grantedBy).toBe(ids.userId);
    expect(found.ok && found.value?.granteeUserId).toBeNull();
  });

  it("a grant SURVIVES soft-delete (deleted_at is an UPDATE, not a row delete)", async () => {
    await store.grant(RID, "a@b.com", ids.userId, null);
    const repo = new DrizzleReportRepository(tdb.ctx);
    await repo.softDelete(RID);
    const stillThere = await store.listByReport(RID);
    expect(stillThere.ok && stillThere.value).toHaveLength(1);
  });

  it("cascades on a HARD report delete (report_id ON DELETE CASCADE)", async () => {
    await store.grant(RID, "a@b.com", ids.userId, null);
    // Delete the reports row directly (no use case hard-deletes today — this
    // pins the FK for the future purge job; review #150 M-4: the old test only
    // exercised soft-delete, so a CASCADE→RESTRICT regression passed silently).
    await tdb.ctx.current().delete(reports).where(eq(reports.id, RID));
    const gone = await store.listByReport(RID);
    expect(gone.ok && gone.value).toHaveLength(0);
  });

  it("listByReport reflects a revoke immediately", async () => {
    await store.grant(RID, "a@b.com", ids.userId, null);
    await store.grant(RID, "c@d.com", ids.userId, null);
    await store.revoke(RID, "a@b.com");
    const listed = await store.listByReport(RID);
    expect(listed.ok && listed.value.map((g) => g.granteeEmail)).toEqual(["c@d.com"]);
  });
});

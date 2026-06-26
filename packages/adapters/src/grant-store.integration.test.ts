// Integration tests for DrizzleGrantStore against real Postgres (pglite) — the
// allowlist revocation-C grant lifecycle (ADR-0056). A report is seeded first (the
// report_grants.report_id FK), then grant/isGranted/revoke/revokeAll are exercised.
import { createReport, makeSlug, reportId, versionId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleGrantStore } from "./grant-store";
import { DrizzleReportRepository } from "./report-repository";
import { makeTestDb, type SeededIdentity, seedIdentity, type TestDb } from "./testing/pglite";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");

async function live(store: DrizzleGrantStore, email: string): Promise<boolean> {
  const r = await store.isGranted(RID, email);
  if (!r.ok) throw new Error("isGranted failed");
  return r.value;
}

describe("DrizzleGrantStore (pglite integration, ADR-0056 revocation-C)", () => {
  let tdb: TestDb;
  let store: DrizzleGrantStore;
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
    store = new DrizzleGrantStore(tdb.ctx);
  });
  afterEach(() => tdb.close());

  it("grant makes a live grant; revoke removes it (immediate revocation)", async () => {
    expect(await live(store, "a@b.com")).toBe(false);
    await store.grant(RID, "a@b.com", Date.now() + 60_000);
    expect(await live(store, "a@b.com")).toBe(true);
    await store.revoke(RID, "a@b.com");
    expect(await live(store, "a@b.com")).toBe(false);
  });

  it("an expired grant is not live", async () => {
    await store.grant(RID, "a@b.com", Date.now() - 1_000);
    expect(await live(store, "a@b.com")).toBe(false);
  });

  it("grant upserts in place (refreshes expiry, no PK conflict)", async () => {
    await store.grant(RID, "a@b.com", Date.now() - 1_000); // expired
    expect(await live(store, "a@b.com")).toBe(false);
    await store.grant(RID, "a@b.com", Date.now() + 60_000); // refresh → live
    expect(await live(store, "a@b.com")).toBe(true);
  });

  it("matches email case-insensitively (grant A@B.com → check a@b.com)", async () => {
    await store.grant(RID, "A@B.com", Date.now() + 60_000);
    expect(await live(store, "a@b.com")).toBe(true);
    await store.revoke(RID, "  A@B.COM ");
    expect(await live(store, "a@b.com")).toBe(false);
  });

  it("revokeAll clears every grant for the report", async () => {
    await store.grant(RID, "a@b.com", Date.now() + 60_000);
    await store.grant(RID, "c@d.io", Date.now() + 60_000);
    await store.revokeAll(RID);
    expect(await live(store, "a@b.com")).toBe(false);
    expect(await live(store, "c@d.io")).toBe(false);
  });
});

// Integration tests for DrizzleReportRepository against real Postgres (pglite).
// These exercise the actual adapter SQL — the layer pure-mapper tests can't reach
// and where the 2026-06-15 viewer-404 bug lived (ON CONFLICT dropping scan_status).
import {
  applyScanResult,
  createFolder,
  folderId,
  makeSlug,
  placeInFolder,
  type Report,
  reportId,
  versionId,
} from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleFolderRepository } from "./folder-repository";
import { DrizzleReportRepository } from "./report-repository";
import {
  makeSampleReport,
  makeTestDb,
  SAMPLE_REPORT_ID,
  SAMPLE_VERSION_ID,
  type SeededIdentity,
  seedIdentity,
  type TestDb,
} from "./testing/pglite";

const RID = SAMPLE_REPORT_ID;
const VID = SAMPLE_VERSION_ID;
const SLUG = "abcde12345";

describe("DrizzleReportRepository (pglite integration)", () => {
  let tdb: TestDb;
  let repo: DrizzleReportRepository;
  let ids: SeededIdentity;

  beforeEach(async () => {
    tdb = await makeTestDb();
    ids = await seedIdentity(tdb.ctx);
    repo = new DrizzleReportRepository(tdb.ctx);
  });
  afterEach(() => tdb.close());

  function makeReport(id: typeof RID, vid: typeof VID, slugStr: string, title: string): Report {
    return makeSampleReport({ id, versionId: vid, slug: slugStr, title }).report;
  }

  function newReport(): Report {
    return makeReport(RID, VID, SLUG, "Q3 metrics");
  }

  it("round-trips a saved report by slug, with the version pending and no live version", async () => {
    const saved = await repo.save(newReport());
    expect(saved.ok).toBe(true);

    const found = await repo.findBySlug(makeSlugOrThrow(SLUG));
    expect(found.ok).toBe(true);
    if (found.ok && found.value) {
      expect(found.value.id).toBe(RID);
      expect(found.value.liveVersionId).toBeNull();
      expect(found.value.versions).toHaveLength(1);
      expect(found.value.versions[0]?.scanStatus).toBe("pending");
    }
  });

  it("setAcl upserts the Acl; findBySlug loads it (default public when unset, ADR-0056)", async () => {
    await repo.save(newReport());
    // No acls row yet → default public.
    const before = await repo.findBySlug(makeSlugOrThrow(SLUG));
    expect(before.ok && before.value?.acl).toEqual({ mode: "public" });

    // Set password mode → persisted + loaded.
    await repo.setAcl(RID, { mode: "password", passwordHash: "$argon2id$abc" });
    const pw = await repo.findBySlug(makeSlugOrThrow(SLUG));
    expect(pw.ok && pw.value?.acl).toEqual({ mode: "password", passwordHash: "$argon2id$abc" });

    // Change to allowlist → the onConflictDoUpdate upserts in place (one row per report);
    // the owner-set access_ttl_seconds round-trips (ADR-0056).
    await repo.setAcl(RID, {
      mode: "allowlist",
      allowedEmails: ["a@b.com", "c@d.io"],
      accessTtlSeconds: 86_400,
    });
    const al = await repo.findBySlug(makeSlugOrThrow(SLUG));
    expect(al.ok && al.value?.acl).toEqual({
      mode: "allowlist",
      allowedEmails: ["a@b.com", "c@d.io"],
      accessTtlSeconds: 86_400,
    });
  });

  it("finds the same report by id", async () => {
    await repo.save(newReport());
    const found = await repo.findById(RID);
    expect(found.ok && found.value?.slug).toBe(SLUG);
  });

  it("returns null for an unknown slug", async () => {
    const found = await repo.findBySlug(makeSlugOrThrow("zzzzzzzzzz"));
    expect(found.ok).toBe(true);
    expect(found.ok && found.value).toBeNull();
  });

  it("listByOrg projects summaries — published flag + soft-deleted excluded", async () => {
    // r1: pending, not published.
    await repo.save(newReport());
    // r2: promoted to clean → published.
    const r2 = makeReport(
      reportId("00000000-0000-4000-8000-0000000000a2"),
      versionId("00000000-0000-4000-8000-0000000000b2"),
      "fghij67890",
      "Second",
    );
    await repo.save(r2);
    await repo.save(applyScanResult(r2, r2.versions[0]?.id ?? VID, "clean").report);
    // r3: soft-deleted → excluded.
    const r3 = makeReport(
      reportId("00000000-0000-4000-8000-0000000000a3"),
      versionId("00000000-0000-4000-8000-0000000000b3"),
      "klmno13579",
      "Deleted",
    );
    await repo.save({ ...r3, deletedAt: Date.now() });

    const listed = await repo.listByOrg(ids.orgId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    const byTitle = new Map(listed.value.map((s) => [s.title, s]));
    expect(byTitle.has("Deleted")).toBe(false); // soft-deleted excluded
    expect(byTitle.get("Q3 metrics")).toMatchObject({ slug: SLUG, isPublished: false });
    expect(byTitle.get("Second")).toMatchObject({ isPublished: true });
  });

  it("persists a moved report's new folder_id on re-save (moveReport)", async () => {
    await repo.save(newReport()); // created in Root (ids.folderId)

    const folders = new DrizzleFolderRepository(tdb.ctx);
    const target = createFolder({
      id: folderId("00000000-0000-4000-8000-0000000000d1"),
      orgId: ids.orgId,
      parentId: ids.folderId,
      name: "Target",
    });
    if (!target.ok) throw new Error("bad folder");
    await folders.save(target.value);

    const loaded = await repo.findBySlug(makeSlugOrThrow(SLUG));
    if (!loaded.ok || !loaded.value) throw new Error("load failed");
    await repo.save(placeInFolder(loaded.value, target.value.id));

    const after = await repo.findBySlug(makeSlugOrThrow(SLUG));
    expect(after.ok && after.value?.folderId).toBe(target.value.id);
  });

  it("REGRESSION: re-saving after a clean verdict persists the version's scan_status", async () => {
    // The exact viewer-404 scenario: upload (pending) → drain promotes (clean) →
    // re-save. The version row must end up `clean`, not stuck at `pending`.
    await repo.save(newReport());

    const promoted = applyScanResult(newReport(), VID, "clean").report;
    const saved = await repo.save(promoted);
    expect(saved.ok).toBe(true);

    const found = await repo.findBySlug(makeSlugOrThrow(SLUG));
    expect(found.ok).toBe(true);
    if (found.ok && found.value) {
      expect(found.value.liveVersionId).toBe(VID);
      const live = found.value.versions.find((v) => v.id === found.value?.liveVersionId);
      expect(live?.scanStatus).toBe("clean");
    }
  });

  it("softDelete sets deleted_at and excludes the report from listByOrg", async () => {
    const created = newReport();
    await repo.save(created);
    const del = await repo.softDelete(created.id);
    expect(del.ok).toBe(true);

    const list = await repo.listByOrg(ids.orgId);
    expect(list.ok && list.value.some((s) => s.slug === SLUG)).toBe(false);
    // findBySlug still resolves it (no deleted_at filter) with deletedAt set — the
    // viewer reads this to return 410 (ADR-0038).
    const found = await repo.findBySlug(makeSlugOrThrow(SLUG));
    expect(found.ok && found.value?.deletedAt).not.toBeNull();
  });

  it("searchByOrg pages, counts, and filters by title", async () => {
    await repo.save(
      makeReport(
        reportId("00000000-0000-4000-8000-0000000000d1"),
        versionId("00000000-0000-4000-8000-0000000000e1"),
        "rpt0000001",
        "Quarterly revenue",
      ),
    );
    await repo.save(
      makeReport(
        reportId("00000000-0000-4000-8000-0000000000d2"),
        versionId("00000000-0000-4000-8000-0000000000e2"),
        "rpt0000002",
        "Annual summary",
      ),
    );
    await repo.save(
      makeReport(
        reportId("00000000-0000-4000-8000-0000000000d3"),
        versionId("00000000-0000-4000-8000-0000000000e3"),
        "rpt0000003",
        "Quarterly costs",
      ),
    );

    // page 1 of size 2 → 2 items, has_more (cursor pagination, ADR-0053)
    const page1 = await repo.searchByOrg(ids.orgId, { limit: 2 });
    expect(page1.ok && page1.value.items.length).toBe(2);
    expect(page1.ok && page1.value.hasMore).toBe(true);

    // page 2 via starting_after the last id → the remaining 1, no more
    const cursor = page1.ok ? page1.value.items[1]?.id : undefined;
    const page2 = await repo.searchByOrg(ids.orgId, { limit: 2, startingAfter: cursor });
    expect(page2.ok && page2.value.items.length).toBe(1);
    expect(page2.ok && page2.value.hasMore).toBe(false);

    // title substring (case-insensitive) → 2 "Quarterly" matches
    const q = await repo.searchByOrg(ids.orgId, { query: "quarter", limit: 10 });
    expect(q.ok && q.value.items.length).toBe(2);
  });

  it("searchByOrg excludes soft-deleted reports", async () => {
    const r = makeReport(
      reportId("00000000-0000-4000-8000-0000000000d9"),
      versionId("00000000-0000-4000-8000-0000000000e9"),
      "rpt0000009",
      "Doomed",
    );
    await repo.save(r);
    await repo.softDelete(r.id);
    const res = await repo.searchByOrg(ids.orgId, { query: "Doomed", limit: 10 });
    expect(res.ok && res.value.items.length).toBe(0);
  });

  it("searchByOrg matches LIKE metacharacters literally (no wildcard injection)", async () => {
    await repo.save(
      makeReport(
        reportId("00000000-0000-4000-8000-0000000000da"),
        versionId("00000000-0000-4000-8000-0000000000ea"),
        "rpt000000a",
        "100% complete",
      ),
    );
    await repo.save(
      makeReport(
        reportId("00000000-0000-4000-8000-0000000000db"),
        versionId("00000000-0000-4000-8000-0000000000eb"),
        "rpt000000b",
        "1000 reports",
      ),
    );

    // "100%" must match only the literal "100% complete", not "1000 reports".
    const res = await repo.searchByOrg(ids.orgId, { query: "100%", limit: 10 });
    expect(res.ok && res.value.items.length).toBe(1);
    expect(res.ok && res.value.items[0]?.title).toBe("100% complete");
  });
});

function makeSlugOrThrow(s: string) {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

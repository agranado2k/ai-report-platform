// Integration tests for DrizzleReportRepository against real Postgres (pglite).
// These exercise the actual adapter SQL — the layer pure-mapper tests can't reach
// and where the 2026-06-15 viewer-404 bug lived (ON CONFLICT dropping scan_status).
import {
  applyScanResult,
  createReport,
  makeSlug,
  type Report,
  reportId,
  versionId,
} from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleReportRepository } from "./report-repository";
import { makeTestDb, type SeededIdentity, seedIdentity, type TestDb } from "./testing/pglite";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");
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
    const slug = makeSlug(slugStr);
    if (!slug.ok) throw new Error("bad slug");
    return createReport({
      id,
      orgId: ids.orgId,
      folderId: ids.folderId,
      slug: slug.value,
      title,
      versionId: vid,
      contentHash: "a".repeat(64),
      uploadedBy: ids.userId,
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 11,
    }).report;
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
});

function makeSlugOrThrow(s: string) {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

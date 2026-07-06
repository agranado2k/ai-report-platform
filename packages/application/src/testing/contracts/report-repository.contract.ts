// Shared ReportRepository contract (ADR-0020 port, ADR-0046 two-tier testing).
// Run this ONE suite against both the InMemoryReportRepository fake
// (packages/application/src/testing/contracts/report-repository.contract.test.ts)
// and the DrizzleReportRepository adapter on pglite
// (packages/adapters/src/report-repository.contract.test.ts) — the same
// assertions against both implementations catch fake/real drift at the seam
// instead of relying on comments. Whoever passes `setup()` owns the
// implementation-specific wiring (an in-memory Map vs a real migrated
// Postgres); this file only knows the ReportRepository port.
import {
  applyScanResult,
  makeSlug,
  type OrgId,
  type Report,
  type ReportId,
  reportId,
} from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReportRepository } from "../../ports";

function slugOf(s: string) {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad contract-test slug: ${s}`);
  return r.value;
}

export interface ReportFixtureOverrides {
  readonly id?: ReportId;
  readonly slug?: string;
  readonly title?: string;
}

export interface ReportRepositoryContractHarness {
  readonly repo: ReportRepository;
  /** The org every `makeReport()` fixture belongs to. */
  readonly orgId: OrgId;
  /** A fresh Report aggregate (one pending version) bound to the harness's
   *  seeded org/folder/user — id/slug/title default to a unique auto-generated
   *  value each call, and are overridable so a test can build several
   *  distinguishable reports. */
  makeReport(overrides?: ReportFixtureOverrides): Report;
  /** Release whatever the harness allocated (e.g. close a pglite db); a no-op
   *  for the in-memory fake. */
  teardown(): Promise<void>;
}

/**
 * Runs the ReportRepository contract against `setup()`'s implementation.
 * `label` distinguishes the two runs in test output (e.g. "in-memory" vs
 * "drizzle+pglite"). `setup()` is called fresh before EVERY test.
 */
export function describeReportRepositoryContract(
  label: string,
  setup: () => Promise<ReportRepositoryContractHarness>,
): void {
  describe(`ReportRepository contract (${label})`, () => {
    let h: ReportRepositoryContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("round-trips a saved report by id and by slug", async () => {
      const report = h.makeReport({ slug: "abcde11111", title: "Q3 metrics" });
      expect((await h.repo.save(report)).ok).toBe(true);

      const byId = await h.repo.findById(report.id);
      expect(byId.ok && byId.value?.id).toBe(report.id);
      expect(byId.ok && byId.value?.title).toBe("Q3 metrics");

      const bySlug = await h.repo.findBySlug(slugOf("abcde11111"));
      expect(bySlug.ok && bySlug.value?.id).toBe(report.id);
    });

    it("resolves an unknown id/slug to null (not an error)", async () => {
      const bySlug = await h.repo.findBySlug(slugOf("zzzzzzzzzz"));
      expect(bySlug.ok && bySlug.value).toBeNull();
    });

    it("listByOrg excludes soft-deleted reports", async () => {
      const live = h.makeReport({ slug: "abcde22222", title: "Live" });
      const doomed = h.makeReport({ slug: "abcde33333", title: "Doomed" });
      await h.repo.save(live);
      await h.repo.save({ ...doomed, deletedAt: Date.now() });

      const listed = await h.repo.listByOrg(h.orgId);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.value.some((s) => s.title === "Doomed")).toBe(false);
      expect(listed.value.some((s) => s.title === "Live")).toBe(true);
    });

    it("listByOrg orders newest-write-first, and a re-save (rename) moves a report to the front", async () => {
      const a = h.makeReport({ slug: "abcde44444", title: "A" });
      const b = h.makeReport({ slug: "abcde55555", title: "B" });
      await h.repo.save(a);
      await h.repo.save(b);

      const initial = await h.repo.listByOrg(h.orgId);
      expect(initial.ok && initial.value.map((s) => s.title)).toEqual(["B", "A"]);

      // Re-saving `a` (e.g. a rename) must bump it back to the front — the real
      // adapter does this via `updated_at`; the fake must agree (this is the
      // divergence the ADR-0046 contract suite exists to catch).
      await h.repo.save({ ...a, title: "A renamed" });
      const afterResave = await h.repo.listByOrg(h.orgId);
      expect(afterResave.ok && afterResave.value.map((s) => s.title)).toEqual(["A renamed", "B"]);
    });

    it("listByOrg's isPublished reflects a promoted (clean) live version", async () => {
      const report = h.makeReport({ slug: "abcde66666", title: "Publishable" });
      await h.repo.save(report);
      const before = await h.repo.listByOrg(h.orgId);
      expect(before.ok && before.value.find((s) => s.title === "Publishable")?.isPublished).toBe(
        false,
      );

      const version = report.versions[0];
      if (!version) throw new Error("fixture has no version");
      const promoted = applyScanResult(report, version.id, "clean").report;
      await h.repo.save(promoted);

      const after = await h.repo.listByOrg(h.orgId);
      expect(after.ok && after.value.find((s) => s.title === "Publishable")?.isPublished).toBe(
        true,
      );
    });

    it("softDelete excludes from listByOrg but findBySlug still resolves it (viewer 410, ADR-0038)", async () => {
      const report = h.makeReport({ slug: "abcde77777", title: "Doomed" });
      await h.repo.save(report);
      expect((await h.repo.softDelete(report.id)).ok).toBe(true);

      const listed = await h.repo.listByOrg(h.orgId);
      expect(listed.ok && listed.value.some((s) => s.id === report.id)).toBe(false);

      const found = await h.repo.findBySlug(slugOf("abcde77777"));
      expect(found.ok && found.value?.deletedAt).not.toBeNull();
    });

    it("searchByOrg keyset-paginates newest-created first, honoring startingAfter", async () => {
      const r1 = h.makeReport({ id: idFixture(1), slug: "rpt0000001", title: "One" });
      const r2 = h.makeReport({ id: idFixture(2), slug: "rpt0000002", title: "Two" });
      const r3 = h.makeReport({ id: idFixture(3), slug: "rpt0000003", title: "Three" });
      await h.repo.save(r1);
      await h.repo.save(r2);
      await h.repo.save(r3);

      const page1 = await h.repo.searchByOrg(h.orgId, { limit: 2 });
      expect(page1.ok && page1.value.items).toHaveLength(2);
      expect(page1.ok && page1.value.hasMore).toBe(true);

      const cursor = page1.ok ? page1.value.items[page1.value.items.length - 1]?.id : undefined;
      const page2 = await h.repo.searchByOrg(h.orgId, { limit: 2, startingAfter: cursor });
      expect(page2.ok && page2.value.items).toHaveLength(1);
      expect(page2.ok && page2.value.hasMore).toBe(false);
      // No overlap between the pages.
      const page1Ids = page1.ok ? page1.value.items.map((i) => i.id) : [];
      const page2FirstId = page2.ok ? page2.value.items[0]?.id : undefined;
      expect(page2FirstId !== undefined && page1Ids.includes(page2FirstId)).toBe(false);
    });

    it("searchByOrg endingBefore pages backward from a cursor", async () => {
      const r1 = h.makeReport({ id: idFixture(11), slug: "rpt0000011", title: "Eleven" });
      const r2 = h.makeReport({ id: idFixture(12), slug: "rpt0000012", title: "Twelve" });
      const r3 = h.makeReport({ id: idFixture(13), slug: "rpt0000013", title: "Thirteen" });
      await h.repo.save(r1);
      await h.repo.save(r2);
      await h.repo.save(r3);

      // Newest-first order is [r3, r2, r1] (id DESC). "endingBefore: r1.id"
      // asks for the page immediately BEFORE the oldest item in that
      // newest-first list — i.e. the two newer ones, still newest-first.
      const page = await h.repo.searchByOrg(h.orgId, { limit: 2, endingBefore: r1.id });
      expect(page.ok && page.value.items.map((i) => i.title)).toEqual(["Thirteen", "Twelve"]);
    });

    it("searchByOrg matches a case-insensitive title/slug substring", async () => {
      await h.repo.save(h.makeReport({ slug: "rpt0000021", title: "Quarterly revenue" }));
      await h.repo.save(h.makeReport({ slug: "rpt0000022", title: "Annual summary" }));
      await h.repo.save(h.makeReport({ slug: "rpt0000023", title: "QUARTERLY costs" }));

      const res = await h.repo.searchByOrg(h.orgId, { query: "quarter", limit: 10 });
      expect(res.ok && res.value.items).toHaveLength(2);
    });

    it("searchByOrg escapes LIKE metacharacters — '%' matches only literally", async () => {
      await h.repo.save(h.makeReport({ slug: "rpt0000031", title: "100% complete" }));
      await h.repo.save(h.makeReport({ slug: "rpt0000032", title: "1000 reports" }));

      const res = await h.repo.searchByOrg(h.orgId, { query: "100%", limit: 10 });
      expect(res.ok && res.value.items).toHaveLength(1);
      expect(res.ok && res.value.items[0]?.title).toBe("100% complete");
    });

    it("searchByOrg excludes soft-deleted reports", async () => {
      const r = h.makeReport({ slug: "rpt0000041", title: "Doomed search" });
      await h.repo.save(r);
      await h.repo.softDelete(r.id);
      const res = await h.repo.searchByOrg(h.orgId, { query: "Doomed search", limit: 10 });
      expect(res.ok && res.value.items).toHaveLength(0);
    });
  });
}

/** A deterministic UUIDv7-shaped id — required by the real Postgres `uuid`
 *  column, and kept UUID-shaped for the fake too so both implementations
 *  order the same fixtures identically under a plain string/byte compare. */
function idFixture(n: number): ReportId {
  const hex = n.toString(16).padStart(4, "0");
  return reportId(`00000000-0000-4000-8000-0000${hex}0000`);
}

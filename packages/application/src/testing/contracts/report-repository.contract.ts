// Shared ReportRepository contract (ADR-0020 port, ADR-0046 two-tier testing).
// Run this ONE suite against both the InMemoryReportRepository fake
// (packages/application/src/testing/contracts/report-repository.contract.test.ts)
// and the DrizzleReportRepository adapter on pglite
// (packages/adapters/src/report-repository.contract.test.ts) — the same
// assertions against both implementations catch fake/real drift at the seam
// instead of relying on comments. Whoever passes `setup()` owns the
// implementation-specific wiring (an in-memory Map vs a real migrated
// Postgres); this file only knows the ReportRepository port.
//
// Since ADR-0075, `searchByOrg` is visibility-scoped: every call carries the
// viewing user, and the suite's visibility-matrix block below is the canonical
// executable form of that decision (owned / org / public / write-granted are
// listed; other owners' private / password / allowlist rows do not exist for
// the viewer — not even as metadata).
import {
  addVersion,
  applyScanResult,
  makeSlug,
  type OrgId,
  type Report,
  type ReportId,
  reportId,
  type UserId,
  type VersionId,
} from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReportRepository, ReportViewer } from "../../ports";

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
  /** The user who OWNS every `makeReport()` fixture, as a search viewer. */
  readonly owner: ReportViewer;
  /** A second user in the SAME org who owns nothing — the "colleague" leg of
   *  the ADR-0075 visibility matrix. `email` is always known (for email-grant
   *  tests) and must be a real, seeded identity in the implementation (the
   *  real adapter needs a `users` row to hang a userId grant on). */
  readonly colleague: ReportViewer & { readonly email: string };
  /** Record a write grant (ADR-0060) visible to the repo's search predicate —
   *  same semantics as `WriteGrantStore.grant`. */
  grantWrite(reportId: ReportId, granteeEmail: string, granteeUserId: UserId | null): Promise<void>;
  /** Record an ORG-WIDE write grant (ADR-0078 §1) visible to the same
   *  predicate — same semantics as `OrgWriteGrantStore.grant`, for the org the
   *  harness's fixtures live in. */
  grantOrgWrite(reportId: ReportId): Promise<void>;
  /** A fresh Report aggregate (one pending version) bound to the harness's
   *  seeded org/folder/user — id/slug/title default to a unique auto-generated
   *  value each call, and are overridable so a test can build several
   *  distinguishable reports. */
  makeReport(overrides?: ReportFixtureOverrides): Report;
  /** A fresh, valid-shaped VersionId — for a test appending a second/third
   *  version via `addVersion` + `repo.save()` (both implementations need a
   *  UUID-shaped id; the plain fake tolerates any string but the real Postgres
   *  `uuid` column does not). */
  nextVersionId(): VersionId;
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

    it("searchByOrg's isPublished reflects a promoted (clean) live version", async () => {
      const report = h.makeReport({ slug: "abcde66666", title: "Publishable" });
      await h.repo.save(report);
      const before = await h.repo.searchByOrg(h.orgId, h.owner, { limit: 10 });
      expect(
        before.ok && before.value.items.find((s) => s.title === "Publishable")?.isPublished,
      ).toBe(false);

      const version = report.versions[0];
      if (!version) throw new Error("fixture has no version");
      const promoted = applyScanResult(report, version.id, "clean").report;
      await h.repo.save(promoted);

      const after = await h.repo.searchByOrg(h.orgId, h.owner, { limit: 10 });
      expect(
        after.ok && after.value.items.find((s) => s.title === "Publishable")?.isPublished,
      ).toBe(true);
    });

    it("softDelete excludes from searchByOrg but findBySlug still resolves it (viewer 410, ADR-0038)", async () => {
      const report = h.makeReport({ slug: "abcde77777", title: "Doomed" });
      await h.repo.save(report);
      expect((await h.repo.softDelete(report.id)).ok).toBe(true);

      const listed = await h.repo.searchByOrg(h.orgId, h.owner, { limit: 10 });
      expect(listed.ok && listed.value.items.some((s) => s.id === report.id)).toBe(false);

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

      const page1 = await h.repo.searchByOrg(h.orgId, h.owner, { limit: 2 });
      expect(page1.ok && page1.value.items).toHaveLength(2);
      expect(page1.ok && page1.value.hasMore).toBe(true);

      const cursor = page1.ok ? page1.value.items[page1.value.items.length - 1]?.id : undefined;
      const page2 = await h.repo.searchByOrg(h.orgId, h.owner, { limit: 2, startingAfter: cursor });
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
      const page = await h.repo.searchByOrg(h.orgId, h.owner, { limit: 2, endingBefore: r1.id });
      expect(page.ok && page.value.items.map((i) => i.title)).toEqual(["Thirteen", "Twelve"]);
    });

    it("searchByOrg matches a case-insensitive title/slug substring", async () => {
      await h.repo.save(h.makeReport({ slug: "rpt0000021", title: "Quarterly revenue" }));
      await h.repo.save(h.makeReport({ slug: "rpt0000022", title: "Annual summary" }));
      await h.repo.save(h.makeReport({ slug: "rpt0000023", title: "QUARTERLY costs" }));

      const res = await h.repo.searchByOrg(h.orgId, h.owner, { query: "quarter", limit: 10 });
      expect(res.ok && res.value.items).toHaveLength(2);
    });

    it("searchByOrg escapes LIKE metacharacters — '%' matches only literally", async () => {
      await h.repo.save(h.makeReport({ slug: "rpt0000031", title: "100% complete" }));
      await h.repo.save(h.makeReport({ slug: "rpt0000032", title: "1000 reports" }));

      const res = await h.repo.searchByOrg(h.orgId, h.owner, { query: "100%", limit: 10 });
      expect(res.ok && res.value.items).toHaveLength(1);
      expect(res.ok && res.value.items[0]?.title).toBe("100% complete");
    });

    it("searchByOrg excludes soft-deleted reports", async () => {
      const r = h.makeReport({ slug: "rpt0000041", title: "Doomed search" });
      await h.repo.save(r);
      await h.repo.softDelete(r.id);
      const res = await h.repo.searchByOrg(h.orgId, h.owner, {
        query: "Doomed search",
        limit: 10,
      });
      expect(res.ok && res.value.items).toHaveLength(0);
    });

    // ── The ADR-0078 listing projection ────────────────────────────────────
    // `ownerId` / `aclMode` / `hasOrgWrite` ride the listing so the dashboard
    // can badge every row without an N+1. They come from the join and the
    // EXISTS the visibility predicate already needs, so both implementations
    // must agree on them exactly.

    it("summary: carries the owner, the acl mode and the org-write flag", async () => {
      const r = h.makeReport({ slug: "sum0000001", title: "Projected" });
      await h.repo.save(r);
      await h.repo.setAcl(r.id, { mode: "org" });
      await h.grantOrgWrite(r.id);
      const page = await h.repo.searchByOrg(h.orgId, h.owner, { limit: 50 });
      const item = page.ok ? page.value.items.find((i) => i.title === "Projected") : undefined;
      expect(item).toMatchObject({ ownerId: h.owner.userId, aclMode: "org", hasOrgWrite: true });
    });

    it("summary: a report with NO acls row projects as `private`, not as a missing mode", async () => {
      // The private-by-default (ADR-0056), applied to the projection — a
      // nullable join column reaching the UI as undefined would badge an
      // owner's private report as nothing at all.
      const r = h.makeReport({ slug: "sum0000002", title: "Bare" });
      await h.repo.save(r);
      const page = await h.repo.searchByOrg(h.orgId, h.owner, { limit: 50 });
      const item = page.ok ? page.value.items.find((i) => i.title === "Bare") : undefined;
      expect(item).toMatchObject({ aclMode: "private", hasOrgWrite: false });
    });

    // ── The ADR-0075 visibility matrix ─────────────────────────────────────
    // Fixture owner = h.owner; viewer under test = h.colleague (same org,
    // owns nothing). "Visible" = the row is in the page; "invisible" = the
    // row is absent entirely (existence is private).

    async function titlesFor(viewer: ReportViewer): Promise<readonly string[]> {
      const res = await h.repo.searchByOrg(h.orgId, viewer, { limit: 50 });
      if (!res.ok) throw new Error(`searchByOrg failed: ${res.error.message}`);
      return res.value.items.map((i) => i.title);
    }

    it("visibility: the owner sees their own report in every acl mode (incl. default private)", async () => {
      const priv = h.makeReport({ slug: "vis0000001", title: "Own private" });
      await h.repo.save(priv); // no acls row = private by default
      const pw = h.makeReport({ slug: "vis0000002", title: "Own password" });
      await h.repo.save(pw);
      await h.repo.setAcl(pw.id, { mode: "password", passwordHash: "$argon2id$x" });

      const titles = await titlesFor(h.owner);
      expect(titles).toContain("Own private");
      expect(titles).toContain("Own password");
    });

    it("visibility: another owner's default-private report is invisible to a same-org colleague", async () => {
      await h.repo.save(h.makeReport({ slug: "vis0000011", title: "Colleague-invisible" }));
      expect(await titlesFor(h.colleague)).not.toContain("Colleague-invisible");
    });

    it("visibility: org-mode and public-mode reports are listed for a same-org colleague", async () => {
      const orgShared = h.makeReport({ slug: "vis0000021", title: "Org shared" });
      await h.repo.save(orgShared);
      await h.repo.setAcl(orgShared.id, { mode: "org" });
      const pub = h.makeReport({ slug: "vis0000022", title: "Public shared" });
      await h.repo.save(pub);
      await h.repo.setAcl(pub.id, { mode: "public" });

      const titles = await titlesFor(h.colleague);
      expect(titles).toContain("Org shared");
      expect(titles).toContain("Public shared");
    });

    it("visibility: password and allowlist reports are invisible to a non-owner (existence is private)", async () => {
      const pw = h.makeReport({ slug: "vis0000031", title: "Password gated" });
      await h.repo.save(pw);
      await h.repo.setAcl(pw.id, { mode: "password", passwordHash: "$argon2id$x" });
      const al = h.makeReport({ slug: "vis0000032", title: "Allowlist gated" });
      await h.repo.save(al);
      // Even the colleague's OWN email on the allowlist does not list the
      // report — allowlist grants viewer access via the magic link, not a
      // listing presence (ADR-0075's deliberate exclusion).
      await h.repo.setAcl(al.id, {
        mode: "allowlist",
        allowedEmails: [h.colleague.email],
        accessTtlSeconds: 3600,
      });

      const titles = await titlesFor(h.colleague);
      expect(titles).not.toContain("Password gated");
      expect(titles).not.toContain("Allowlist gated");
    });

    it("visibility: a userId write grant lists an otherwise-private report for the grantee", async () => {
      const r = h.makeReport({ slug: "vis0000041", title: "Granted by userId" });
      await h.repo.save(r);
      await h.grantWrite(r.id, h.colleague.email, h.colleague.userId);
      expect(await titlesFor(h.colleague)).toContain("Granted by userId");
    });

    it("visibility: an email-only write grant (granteeUserId null) matches the viewer's email case-insensitively", async () => {
      const r = h.makeReport({ slug: "vis0000042", title: "Granted by email" });
      await h.repo.save(r);
      await h.grantWrite(r.id, h.colleague.email, null);
      const upper = { userId: h.colleague.userId, email: h.colleague.email.toUpperCase() };
      expect(await titlesFor(upper)).toContain("Granted by email");
    });

    it("visibility: a write grant for someone ELSE does not list the report for the colleague", async () => {
      const r = h.makeReport({ slug: "vis0000043", title: "Granted elsewhere" });
      await h.repo.save(r);
      await h.grantWrite(r.id, "unrelated@example.test", null);
      expect(await titlesFor(h.colleague)).not.toContain("Granted elsewhere");
    });

    // ── The ADR-0078 org-write leg ─────────────────────────────────────────
    // In the three states the sharing control produces, this leg is redundant:
    // `org_edit` always implies acl=org, which the broad-share leg already
    // catches. It exists because the API can produce an org-write row on a
    // report that is NOT acl=org (the grant and the Acl are separate
    // resources), and a listing that hid a report the viewer can EDIT would be
    // dishonest in exactly the way ADR-0075 exists to prevent.

    it("visibility: an ORG write grant lists an otherwise-private report for a same-org colleague", async () => {
      const r = h.makeReport({ slug: "vis0000051", title: "Org-writable" });
      await h.repo.save(r); // no acls row = private by default
      await h.grantOrgWrite(r.id);
      expect(await titlesFor(h.colleague)).toContain("Org-writable");
    });

    it("visibility: an org-write report the viewer cannot edit is still not conjured from nothing", async () => {
      // The control: an otherwise-identical report WITHOUT the row stays
      // invisible, so the assertion above is testing the leg and not the
      // fixture.
      const r = h.makeReport({ slug: "vis0000052", title: "No org write" });
      await h.repo.save(r);
      expect(await titlesFor(h.colleague)).not.toContain("No org write");
    });

    it("visibility: the org-write leg survives alongside acl=org (the normal org_edit state)", async () => {
      const r = h.makeReport({ slug: "vis0000053", title: "Org edit" });
      await h.repo.save(r);
      await h.repo.setAcl(r.id, { mode: "org" });
      await h.grantOrgWrite(r.id);
      const titles = await titlesFor(h.colleague);
      // Listed exactly ONCE — the EXISTS probe must not fan the row out.
      expect(titles.filter((t) => t === "Org edit")).toHaveLength(1);
    });

    it("hasReportsInFolder reflects live reports only — org-scoped, not visibility-scoped", async () => {
      const r = h.makeReport({ slug: "vis0000061", title: "Occupant" });
      // Empty before any save.
      const before = await h.repo.hasReportsInFolder(h.orgId, r.folderId);
      expect(before.ok && before.value).toBe(false);

      // A default-private report the colleague can't SEE still occupies the
      // folder (the deleteFolder guard must not be fooled by invisibility).
      await h.repo.save(r);
      const occupied = await h.repo.hasReportsInFolder(h.orgId, r.folderId);
      expect(occupied.ok && occupied.value).toBe(true);

      // Soft-deleting the report frees the folder again.
      await h.repo.softDelete(r.id);
      const after = await h.repo.hasReportsInFolder(h.orgId, r.folderId);
      expect(after.ok && after.value).toBe(false);
    });

    it("listVersions returns the report's versions newest-created first (ADR-0065)", async () => {
      const report = h.makeReport({ slug: "rpt0000051", title: "Versioned" });
      await h.repo.save(report);
      const uploader = report.versions[0]?.uploadedBy;
      if (!uploader) throw new Error("fixture has no v1");
      const added = addVersion(report, {
        versionId: h.nextVersionId(),
        contentHash: "b".repeat(64),
        uploadedBy: uploader,
        manifest: { entryDocument: "index.html", files: ["index.html"] },
        sizeBytes: 22,
      });
      if (!added.ok) throw new Error("addVersion failed");
      await h.repo.save(added.value.report);

      const page = await h.repo.listVersions(report.id, { limit: 10 });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(page.value.items.map((v) => v.versionNo)).toEqual([2, 1]);
      expect(page.value.hasMore).toBe(false);
      expect(page.value.items[1]?.origin).toBe("upload");
      expect(page.value.items[1]?.sizeBytes).toBe(11);
      expect(page.value.items[1]?.uploadedBy).toBe(report.versions[0]?.uploadedBy);
      expect(typeof page.value.items[1]?.uploadedAt).toBe("number");
    });

    it("listVersions keyset-paginates newest-created first, honoring startingAfter", async () => {
      let report = h.makeReport({ slug: "rpt0000052", title: "Many versions" });
      await h.repo.save(report);
      const uploader = report.versions[0]?.uploadedBy;
      if (!uploader) throw new Error("fixture has no v1");
      for (let i = 0; i < 3; i += 1) {
        const added = addVersion(report, {
          versionId: h.nextVersionId(),
          contentHash: `c${i}`.repeat(16),
          uploadedBy: uploader,
          manifest: { entryDocument: "index.html", files: ["index.html"] },
          sizeBytes: 33,
        });
        if (!added.ok) throw new Error("addVersion failed");
        report = added.value.report;
        await h.repo.save(report);
      }
      // 4 versions total (v1 from makeReport + 3 appended).
      const page1 = await h.repo.listVersions(report.id, { limit: 2 });
      expect(page1.ok && page1.value.items).toHaveLength(2);
      expect(page1.ok && page1.value.hasMore).toBe(true);

      const cursor = page1.ok ? page1.value.items[page1.value.items.length - 1]?.id : undefined;
      const page2 = await h.repo.listVersions(report.id, { limit: 2, startingAfter: cursor });
      expect(page2.ok && page2.value.items).toHaveLength(2);
      expect(page2.ok && page2.value.hasMore).toBe(false);
      const page1Ids = page1.ok ? page1.value.items.map((i) => i.id) : [];
      const page2Ids = page2.ok ? page2.value.items.map((i) => i.id) : [];
      expect(page2Ids.some((id) => page1Ids.includes(id))).toBe(false);
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

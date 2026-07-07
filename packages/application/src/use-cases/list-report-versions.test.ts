// listReportVersions use case (ADR-0065). Auth mirrors getReport exactly (the
// same org-scoped loadOrgReport guard, ADR-0059 §3) — happy path, cross-org,
// not-found, and soft-deleted are the same three/four cases as
// get-report.test.ts. Pagination mirrors search-reports.test.ts's cursor
// assertions.
import {
  addVersion,
  createReport,
  folderId,
  makeSlug,
  orgId,
  type Report,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryReportRepository } from "../testing/in-memory";
import { listReportVersions } from "./list-report-versions";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const uploader = userId("00000000-0000-7000-8000-0000000000d1");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

function versionIdOf(n: number) {
  return versionId(`00000000-0000-7000-8000-${n.toString().padStart(12, "0")}`);
}

function report(org: typeof orgA, slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: folderId("00000000-0000-7000-8000-0000000000a0"),
    slug: slug(slugStr),
    title: "A Title",
    versionId: versionIdOf(1),
    contentHash: "h".repeat(64),
    uploadedBy: uploader,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

/** Append `n` more versions (v2, v3, …) to `r`, each with a strictly-increasing
 *  UUID-shaped id so the fake's string-keyset sorts them newest-created-first. */
function withVersions(r: Report, n: number): Report {
  let current = r;
  for (let i = 0; i < n; i += 1) {
    const nextNo = current.versions.length + 1;
    const added = addVersion(current, {
      versionId: versionIdOf(nextNo),
      contentHash: `hash-${nextNo}`.padEnd(64, "0"),
      uploadedBy: uploader,
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: nextNo,
    });
    if (!added.ok) throw new Error("addVersion failed in test fixture");
    current = added.value.report;
  }
  return current;
}

describe("listReportVersions use case", () => {
  it("returns a report's versions newest-created first, for an org member", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(withVersions(report(orgA, "aaaaaaaaaa"), 2)); // v1, v2, v3
    const r = await listReportVersions({ reports }, { orgId: orgA }, { slug: slug("aaaaaaaaaa") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    expect(r.value.hasMore).toBe(false);
    expect(r.value.items[0]?.origin).toBe("upload");
    expect(r.value.items[0]?.uploadedBy).toBe(uploader);
  });

  it("rejects a cross-org report with NotAllowed", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "bbbbbbbbbb"));
    const r = await listReportVersions({ reports }, { orgId: orgB }, { slug: slug("bbbbbbbbbb") });
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an unknown report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const r = await listReportVersions({ reports }, { orgId: orgA }, { slug: slug("cccccccccc") });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects a soft-deleted report with NotFound (mirrors getReport)", async () => {
    const reports = new InMemoryReportRepository();
    const doomed = report(orgA, "dddddddddd");
    await reports.save({ ...doomed, deletedAt: Date.now() });
    const r = await listReportVersions({ reports }, { orgId: orgA }, { slug: slug("dddddddddd") });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("paginates with a default limit and honors an explicit limit + has_more", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(withVersions(report(orgA, "eeeeeeeeee"), 4)); // 5 versions total
    const page = await listReportVersions(
      { reports },
      { orgId: orgA },
      { slug: slug("eeeeeeeeee"), limit: 2 },
    );
    expect(page.ok && page.value.items.length).toBe(2);
    expect(page.ok && page.value.hasMore).toBe(true);
    expect(page.ok && page.value.items.map((v) => v.versionNo)).toEqual([5, 4]);
  });

  it("pages forward with startingAfter, no overlap, until has_more is false", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(withVersions(report(orgA, "ffffffffff"), 4)); // 5 versions total
    const seen = new Set<string>();
    let cursor: ReturnType<typeof versionId> | undefined;
    let pages = 0;
    for (;;) {
      const r = await listReportVersions(
        { reports },
        { orgId: orgA },
        { slug: slug("ffffffffff"), limit: 2, startingAfter: cursor },
      );
      if (!r.ok) throw new Error("list failed");
      for (const v of r.value.items) {
        expect(seen.has(v.id)).toBe(false);
        seen.add(v.id);
      }
      pages += 1;
      if (!r.value.hasMore) break;
      cursor = r.value.items[r.value.items.length - 1]?.id;
    }
    expect(seen.size).toBe(5);
    expect(pages).toBe(3); // 2 + 2 + 1
  });

  it("clamps the limit (default 20; over-max still returns all when small)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(withVersions(report(orgA, "1a1a1a1a1a"), 2)); // 3 versions
    const def = await listReportVersions(
      { reports },
      { orgId: orgA },
      { slug: slug("1a1a1a1a1a") },
    );
    expect(def.ok && def.value.items.length).toBe(3);
    const big = await listReportVersions(
      { reports },
      { orgId: orgA },
      { slug: slug("1a1a1a1a1a"), limit: 100_000 },
    );
    expect(big.ok && big.value.items.length).toBe(3);
  });
});

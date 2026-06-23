import {
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
import { searchReports } from "./search-reports";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const F1 = folderId("00000000-0000-7000-8000-0000000000f1");
const F2 = folderId("00000000-0000-7000-8000-0000000000f2");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}
function rep(slugStr: string, title: string, folder = F1): Report {
  return createReport({
    id: reportId(`id-${slugStr}`), // unique per slug (the fake keys byId)
    orgId: orgA,
    folderId: folder,
    slug: slug(slugStr),
    title,
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

async function seed(n: number) {
  const reports = new InMemoryReportRepository();
  for (let i = 0; i < n; i++) {
    await reports.save(rep(`aaaaaaaa${String(i).padStart(2, "0")}`, `Report ${i}`));
  }
  return reports;
}

describe("searchReports use case (cursor pagination, ADR-0053)", () => {
  it("returns the first page newest-created-first, with has_more", async () => {
    const reports = await seed(25);
    const r = await searchReports({ reports }, { orgId: orgA }, { limit: 10 });
    expect(r.ok && r.value.items.length).toBe(10);
    expect(r.ok && r.value.hasMore).toBe(true);
    // id DESC = newest-created first → Report 24 leads (highest id suffix)
    expect(r.ok && r.value.items[0]?.title).toBe("Report 24");
  });

  it("pages forward with starting_after until has_more is false, no overlap", async () => {
    const reports = await seed(25);
    const seen = new Set<string>();
    let cursor: ReturnType<typeof reportId> | undefined;
    let pages = 0;
    for (;;) {
      const r = await searchReports(
        { reports },
        { orgId: orgA },
        { limit: 10, startingAfter: cursor },
      );
      if (!r.ok) throw new Error("search failed");
      for (const it of r.value.items) {
        expect(seen.has(it.id)).toBe(false); // no overlap across pages
        seen.add(it.id);
      }
      pages++;
      if (!r.value.hasMore) break;
      cursor = r.value.items[r.value.items.length - 1]?.id;
    }
    expect(seen.size).toBe(25); // every report, exactly once
    expect(pages).toBe(3); // 10 + 10 + 5
  });

  it("pages backward with ending_before (Prev) → the previous page, has_more=false at the start", async () => {
    const reports = await seed(25);
    const p1 = await searchReports({ reports }, { orgId: orgA }, { limit: 10 });
    if (!p1.ok) throw new Error("p1");
    const p2 = await searchReports(
      { reports },
      { orgId: orgA },
      { limit: 10, startingAfter: p1.value.items[9]?.id },
    );
    if (!p2.ok) throw new Error("p2");
    // ending_before page 2's first id → back to page 1's items, in the same order
    const back = await searchReports(
      { reports },
      { orgId: orgA },
      { limit: 10, endingBefore: p2.value.items[0]?.id },
    );
    expect(back.ok && back.value.items.map((r) => r.id)).toEqual(p1.value.items.map((r) => r.id));
    // page 1 is the start — no more (newer) items before it
    expect(back.ok && back.value.hasMore).toBe(false);
  });

  it("filters by a case-insensitive title query", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(rep("aaaaaaaaaa", "Quarterly revenue"));
    await reports.save(rep("bbbbbbbbbb", "Annual summary"));
    const r = await searchReports({ reports }, { orgId: orgA }, { query: "QUARTER", limit: 10 });
    expect(r.ok && r.value.items.length).toBe(1);
    expect(r.ok && r.value.hasMore).toBe(false);
    expect(r.ok && r.value.items[0]?.title).toBe("Quarterly revenue");
  });

  it("filters by folder", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(rep("aaaaaaaaaa", "In F1", F1));
    await reports.save(rep("bbbbbbbbbb", "In F2", F2));
    const r = await searchReports({ reports }, { orgId: orgA }, { folderId: F2, limit: 10 });
    expect(r.ok && r.value.items.length).toBe(1);
    expect(r.ok && r.value.items[0]?.folderId).toBe(F2);
  });

  it("clamps the limit (default 20; over-max returns all when small)", async () => {
    const reports = await seed(3);
    const def = await searchReports({ reports }, { orgId: orgA }, {}); // no limit → default
    expect(def.ok && def.value.items.length).toBe(3);
    const big = await searchReports({ reports }, { orgId: orgA }, { limit: 100_000 });
    expect(big.ok && big.value.items.length).toBe(3); // clamped to ≤100, all 3 fit
  });
});

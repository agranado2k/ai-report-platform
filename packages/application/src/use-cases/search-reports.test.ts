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

describe("searchReports use case", () => {
  it("returns the requested page and the total", async () => {
    const reports = await seed(25);
    const r = await searchReports({ reports }, { orgId: orgA }, { page: 1, pageSize: 10 });
    expect(r.ok && r.value.items.length).toBe(10);
    expect(r.ok && r.value.total).toBe(25);
    expect(r.ok && r.value.page).toBe(1);
  });

  it("returns the last partial page", async () => {
    const reports = await seed(25);
    const r = await searchReports({ reports }, { orgId: orgA }, { page: 3, pageSize: 10 });
    expect(r.ok && r.value.items.length).toBe(5);
  });

  it("filters by a case-insensitive title query", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(rep("aaaaaaaaaa", "Quarterly revenue"));
    await reports.save(rep("bbbbbbbbbb", "Annual summary"));
    const r = await searchReports(
      { reports },
      { orgId: orgA },
      { query: "QUARTER", page: 1, pageSize: 10 },
    );
    expect(r.ok && r.value.total).toBe(1);
    expect(r.ok && r.value.items[0]?.title).toBe("Quarterly revenue");
  });

  it("filters by folder", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(rep("aaaaaaaaaa", "In F1", F1));
    await reports.save(rep("bbbbbbbbbb", "In F2", F2));
    const r = await searchReports(
      { reports },
      { orgId: orgA },
      { folderId: F2, page: 1, pageSize: 10 },
    );
    expect(r.ok && r.value.total).toBe(1);
    expect(r.ok && r.value.items[0]?.folderId).toBe(F2);
  });

  it("clamps a page below 1 to page 1", async () => {
    const reports = await seed(3);
    const r = await searchReports({ reports }, { orgId: orgA }, { page: 0, pageSize: 10 });
    expect(r.ok && r.value.page).toBe(1);
    expect(r.ok && r.value.items.length).toBe(3);
  });
});

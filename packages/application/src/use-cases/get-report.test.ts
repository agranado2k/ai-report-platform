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
import { getReport } from "./get-report";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}
function report(org: typeof orgA, slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: folderId("00000000-0000-7000-8000-0000000000a0"),
    slug: slug(slugStr),
    title: "A Title",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

describe("getReport use case", () => {
  it("returns a report that belongs to the actor's org", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await getReport({ reports }, { orgId: orgA }, { slug: slug("aaaaaaaaaa") });
    expect(r.ok && r.value.title).toBe("A Title");
    expect(r.ok && r.value.slug).toBe("aaaaaaaaaa");
  });

  it("rejects a cross-org report with NotAllowed", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "bbbbbbbbbb"));
    const r = await getReport({ reports }, { orgId: orgB }, { slug: slug("bbbbbbbbbb") });
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an unknown report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const r = await getReport({ reports }, { orgId: orgA }, { slug: slug("cccccccccc") });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });
});

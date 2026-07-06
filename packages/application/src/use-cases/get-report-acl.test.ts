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
import { getReportAcl } from "./get-report-acl";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}
function report(slugStr: string, deletedAt: number | null = null): Report {
  return {
    ...createReport({
      id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
      orgId: orgA,
      folderId: folderId("00000000-0000-7000-8000-0000000000a0"),
      slug: slug(slugStr),
      title: "A Title",
      versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
      contentHash: "h".repeat(64),
      uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 1,
    }).report,
    deletedAt,
  };
}

describe("getReportAcl use case (unauthenticated — the public unlock flow)", () => {
  it("returns the report (with its Acl) for any org — no actor/org scoping", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report("aaaaaaaaaa"));
    const r = await getReportAcl({ reports }, { slug: slug("aaaaaaaaaa") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value?.slug).toBe("aaaaaaaaaa");
    expect(r.value?.acl).toBeDefined();
  });

  it("returns null (not NotFound) for an unknown slug — the route renders its own 'not available'", async () => {
    const reports = new InMemoryReportRepository();
    const r = await getReportAcl({ reports }, { slug: slug("bbbbbbbbbb") });
    expect(r.ok && r.value).toBeNull();
  });

  it("returns null for a soft-deleted report", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report("cccccccccc", Date.now()));
    const r = await getReportAcl({ reports }, { slug: slug("cccccccccc") });
    expect(r.ok && r.value).toBeNull();
  });
});

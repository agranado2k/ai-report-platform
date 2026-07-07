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
import { deleteReport } from "./delete-report";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const otherUser = userId("00000000-0000-7000-8000-0000000000d2");
const ownerActor = { orgId: orgA, userId: owner };

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
    title: "A report",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

describe("deleteReport use case", () => {
  it("soft-deletes a report (excluded from listByOrg)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await deleteReport({ reports }, ownerActor, { slug: slug("aaaaaaaaaa") });
    expect(r.ok).toBe(true);
    const list = await reports.listByOrg(orgA);
    expect(list.ok && list.value.some((s) => s.slug === "aaaaaaaaaa")).toBe(false);
  });

  it("rejects a non-owner (even same-org) with NotAllowed (ADR-0059: delete is owner-only)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "bbbbbbbbbb"));
    const r = await deleteReport(
      { reports },
      { orgId: orgA, userId: otherUser },
      { slug: slug("bbbbbbbbbb") },
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "you do not own this report" });
  });

  it("rejects an unknown report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const r = await deleteReport({ reports }, ownerActor, { slug: slug("cccccccccc") });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects an already-deleted report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "dddddddddd"));
    await deleteReport({ reports }, ownerActor, { slug: slug("dddddddddd") });
    const again = await deleteReport({ reports }, ownerActor, { slug: slug("dddddddddd") });
    expect(!again.ok && again.error.kind).toBe("NotFound");
  });
});

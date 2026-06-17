import {
  createReport,
  folderId as makeFolderId,
  orgId as makeOrgId,
  reportId as makeReportId,
  makeSlug,
  userId as makeUserId,
  versionId as makeVersionId,
  type Report,
  type Slug,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryReportRepository } from "../testing/in-memory";
import { listReports } from "./list-reports";

const orgA = makeOrgId("00000000-0000-7000-8000-0000000000a1");
const orgB = makeOrgId("00000000-0000-7000-8000-0000000000b1");
const folder = makeFolderId("00000000-0000-7000-8000-0000000000f1");
const user = makeUserId("00000000-0000-7000-8000-000000000011");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad test slug: ${s}`);
  return r.value;
}

/** Build a pending report; pass `publish` to mark its v1 clean + live. */
function build(
  org: typeof orgA,
  n: number,
  slugStr: string,
  title: string,
  publish = false,
): Report {
  const versionId = makeVid(n);
  const { report } = createReport({
    id: makeReportId(`00000000-0000-7000-8000-0000000000${10 + n}`),
    orgId: org,
    folderId: folder,
    slug: slug(slugStr),
    title,
    versionId,
    contentHash: `hash-${n}`,
    uploadedBy: user,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  });
  if (!publish) return report;
  return {
    ...report,
    liveVersionId: versionId,
    versions: [{ ...report.versions[0]!, scanStatus: "clean" }],
  };
}

function makeVid(n: number) {
  return makeVersionId(`00000000-0000-7000-8000-0000000000${20 + n}`);
}

describe("listReports (dashboard report list)", () => {
  it("returns only the acting org's reports, newest first, as summaries", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(build(orgA, 1, "aaaaaaaaaa", "Alpha", true)); // published
    await reports.save(build(orgA, 2, "bbbbbbbbbb", "Beta")); // pending
    await reports.save(build(orgB, 3, "cccccccccc", "Other org"));

    const r = await listReports({ reports }, { orgId: orgA });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Org isolation: orgB's report is absent.
    expect(r.value.map((s) => s.title)).toEqual(["Beta", "Alpha"]); // newest first
    expect(r.value.find((s) => s.title === "Alpha")).toMatchObject({
      slug: "aaaaaaaaaa",
      isPublished: true,
    });
    expect(r.value.find((s) => s.title === "Beta")).toMatchObject({ isPublished: false });
  });

  it("returns an empty list for an org with no reports", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(build(orgB, 3, "cccccccccc", "Other org"));

    const r = await listReports({ reports }, { orgId: orgA });

    expect(r.ok && r.value).toEqual([]);
  });
});

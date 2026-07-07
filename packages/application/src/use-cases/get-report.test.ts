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
import {
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
} from "../testing/in-memory";
import { getReport } from "./get-report";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const grantee = userId("00000000-0000-7000-8000-0000000000d2");
const stranger = userId("00000000-0000-7000-8000-0000000000d3");

function writeDeps() {
  return { grants: new InMemoryWriteGrantStore(), identities: new InMemoryIdentityStore() };
}

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
    const r = await getReport(
      { reports, ...writeDeps() },
      { orgId: orgA, userId: owner },
      { slug: slug("aaaaaaaaaa") },
    );
    expect(r.ok && r.value.title).toBe("A Title");
    expect(r.ok && r.value.slug).toBe("aaaaaaaaaa");
  });

  it("rejects a cross-org, non-grantee actor with NotAllowed", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "bbbbbbbbbb"));
    const r = await getReport(
      { reports, ...writeDeps() },
      { orgId: orgB, userId: stranger },
      { slug: slug("bbbbbbbbbb") },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("a cross-org write-grantee CAN read the metadata (ADR-0060 §4 carve-out)", async () => {
    const reports = new InMemoryReportRepository();
    const seeded = report(orgA, "eeeeeeeeee");
    await reports.save(seeded);
    const grants = new InMemoryWriteGrantStore();
    await grants.grant(seeded.id, "grantee@x.com", owner, grantee);
    const r = await getReport(
      { reports, grants, identities: new InMemoryIdentityStore() },
      { orgId: orgB, userId: grantee },
      { slug: slug("eeeeeeeeee") },
    );
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("rejects an unknown report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const r = await getReport(
      { reports, ...writeDeps() },
      { orgId: orgA, userId: owner },
      { slug: slug("cccccccccc") },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });
});

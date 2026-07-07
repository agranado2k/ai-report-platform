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
import { getAcl } from "./get-acl";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const colleague = userId("00000000-0000-7000-8000-0000000000d2");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}
function report(slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: orgA,
    folderId: folderId("00000000-0000-7000-8000-0000000000a0"),
    slug: slug(slugStr),
    title: "A Title",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: owner,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

describe("getAcl use case (owner-only ACL read, ADR-0059 §3)", () => {
  it("returns the report (and its acl) for the owner", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report("aaaaaaaaaa"));
    const r = await getAcl(
      { reports },
      { orgId: orgA, userId: owner },
      { slug: slug("aaaaaaaaaa") },
    );
    expect(r.ok && r.value.acl.mode).toBe("private");
  });

  it("rejects a same-org non-owner with NotAllowed (share config is the owner's business)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report("bbbbbbbbbb"));
    const r = await getAcl(
      { reports },
      { orgId: orgA, userId: colleague },
      { slug: slug("bbbbbbbbbb") },
    );
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "you do not own this report",
    });
  });

  it("rejects an unknown report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const r = await getAcl(
      { reports },
      { orgId: orgA, userId: owner },
      { slug: slug("cccccccccc") },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });
});

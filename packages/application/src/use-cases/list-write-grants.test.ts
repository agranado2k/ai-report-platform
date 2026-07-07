import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryReportRepository, InMemoryWriteGrantStore } from "../testing/in-memory";
import { listWriteGrants } from "./list-write-grants";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const OTHER_USER = userId("00000000-0000-7000-8000-0000000000d2");
const SLUG = "aaaaaaaaaa";
const ACTOR = { orgId: ORG, userId: OWNER, scopes: ["acl:write"] };
const REPORT_ID = reportId("00000000-0000-7000-8000-0000000000c1");

async function seed() {
  const reports = new InMemoryReportRepository();
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("slug");
  const { report } = createReport({
    id: REPORT_ID,
    orgId: ORG,
    folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
    slug: slug.value,
    title: "T",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: OWNER,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  });
  await reports.save(report);
  const grants = new InMemoryWriteGrantStore();
  await grants.grant(REPORT_ID, "a@b.com", OWNER, null);
  await grants.grant(REPORT_ID, "c@d.com", OWNER, null);
  return { reports, grants };
}

describe("listWriteGrants use case (ADR-0060)", () => {
  it("requires the acl:write scope", async () => {
    const { reports, grants } = await seed();
    const r = await listWriteGrants(
      { reports, grants },
      { orgId: ORG, userId: OWNER, scopes: [] },
      { slug: SLUG as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InsufficientScope");
  });

  it("is owner-only — a same-org non-owner is rejected (NotAllowed)", async () => {
    const { reports, grants } = await seed();
    const r = await listWriteGrants(
      { reports, grants },
      { orgId: ORG, userId: OTHER_USER, scopes: ["acl:write"] },
      { slug: SLUG as never },
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "you do not own this report" });
  });

  it("lists every write grant on the report", async () => {
    const { reports, grants } = await seed();
    const r = await listWriteGrants({ reports, grants }, ACTOR, { slug: SLUG as never });
    expect(r.ok && r.value.map((g) => g.granteeEmail).sort()).toEqual(["a@b.com", "c@d.com"]);
  });

  it("rejects an unknown slug with NotFound", async () => {
    const { reports, grants } = await seed();
    const r = await listWriteGrants({ reports, grants }, ACTOR, { slug: "zzzzzzzzzz" as never });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });
});

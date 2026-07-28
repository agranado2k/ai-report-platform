import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuditLogger,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { revokeWrite } from "./revoke-write";

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
  await grants.grant(REPORT_ID, "grantee@x.com", OWNER, null);
  return { reports, grants, audit: new InMemoryAuditLogger(), uow: new PassThroughUnitOfWork() };
}

describe("revokeWrite use case (ADR-0060)", () => {
  it("requires the acl:write scope", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite(
      { reports, grants, audit, uow },
      { orgId: ORG, userId: OWNER, scopes: [] },
      { slug: SLUG as never, email: "grantee@x.com" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InsufficientScope");
  });

  it("is owner-only — a same-org non-owner is rejected (NotAllowed)", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite(
      { reports, grants, audit, uow },
      { orgId: ORG, userId: OTHER_USER, scopes: ["acl:write"] },
      { slug: SLUG as never, email: "grantee@x.com" },
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "you do not own this report" });
  });

  it("revokes the grant — a subsequent findFor no longer matches", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite({ reports, grants, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "grantee@x.com",
    });
    expect(r.ok).toBe(true);
    const found = await grants.findFor(REPORT_ID, { userId: OTHER_USER, email: "grantee@x.com" });
    expect(found.ok && found.value).toBeNull();
  });

  it("is idempotent — revoking an email with no grant still succeeds", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite({ reports, grants, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "never-granted@x.com",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown slug with NotFound", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite({ reports, grants, audit, uow }, ACTOR, {
      slug: "zzzzzzzzzz" as never,
      email: "grantee@x.com",
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("records a grant.write.revoked audit row (ADR-0070)", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite({ reports, grants, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "grantee@x.com",
    });
    expect(r.ok).toBe(true);
    expect(audit.recorded()).toContainEqual({
      action: "grant.write.revoked",
      orgId: ORG,
      actorUserId: OWNER,
      targetType: "report",
      targetId: REPORT_ID,
      meta: { granteeEmail: "grantee@x.com" },
    });
  });
});

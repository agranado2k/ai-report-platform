import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuditLogger,
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { grantWrite } from "./grant-write";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const OTHER_USER = userId("00000000-0000-7000-8000-0000000000d2");
const SLUG = "aaaaaaaaaa";
const ACTOR = { orgId: ORG, userId: OWNER, scopes: ["acl:write"] };

async function seed() {
  const reports = new InMemoryReportRepository();
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("slug");
  const { report } = createReport({
    id: reportId("00000000-0000-7000-8000-0000000000c1"),
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
  return {
    reports,
    grants: new InMemoryWriteGrantStore(),
    identities: new InMemoryIdentityStore(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
  };
}

describe("grantWrite use case (ADR-0060)", () => {
  it("requires the acl:write scope", async () => {
    const { reports, grants, identities, audit, uow } = await seed();
    const r = await grantWrite(
      { reports, grants, identities, audit, uow },
      { orgId: ORG, userId: OWNER, scopes: [] },
      { slug: SLUG as never, email: "grantee@x.com" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InsufficientScope");
  });

  it("is owner-only — a same-org non-owner is rejected (NotAllowed)", async () => {
    const { reports, grants, identities, audit, uow } = await seed();
    const r = await grantWrite(
      { reports, grants, identities, audit, uow },
      { orgId: ORG, userId: OTHER_USER, scopes: ["acl:write"] },
      { slug: SLUG as never, email: "grantee@x.com" },
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "you do not own this report" });
  });

  it("rejects an unknown slug with NotFound", async () => {
    const { reports, grants, identities, audit, uow } = await seed();
    const r = await grantWrite({ reports, grants, identities, audit, uow }, ACTOR, {
      slug: "zzzzzzzzzz" as never,
      email: "grantee@x.com",
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects a malformed email with ValidationError", async () => {
    const { reports, grants, identities, audit, uow } = await seed();
    const r = await grantWrite({ reports, grants, identities, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "not-an-email",
    });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("grants write, normalizing the email, with granteeUserId null when the grantee hasn't signed up", async () => {
    const { reports, grants, identities, audit, uow } = await seed();
    const r = await grantWrite({ reports, grants, identities, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: " Grantee@X.com ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.granteeEmail).toBe("grantee@x.com");
      expect(r.value.granteeUserId).toBeNull();
      expect(r.value.grantedBy).toBe(OWNER);
    }
  });

  it("resolves granteeUserId opportunistically when the grantee already has an account", async () => {
    const { reports, grants, identities, audit, uow } = await seed();
    identities.seedUser(OTHER_USER, "grantee@x.com");
    const r = await grantWrite({ reports, grants, identities, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "grantee@x.com",
    });
    expect(r.ok && r.value.granteeUserId).toBe(OTHER_USER);
  });

  it("re-granting the same email upserts in place (no duplicate)", async () => {
    const { reports, grants, identities, audit, uow } = await seed();
    await grantWrite({ reports, grants, identities, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "grantee@x.com",
    });
    await grantWrite({ reports, grants, identities, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "grantee@x.com",
    });
    const listed = await grants.listByReport(reportId("00000000-0000-7000-8000-0000000000c1"));
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("records a grant.write.granted audit row (ADR-0070)", async () => {
    const { reports, grants, identities, audit, uow } = await seed();
    identities.seedUser(OTHER_USER, "grantee@x.com");
    const r = await grantWrite({ reports, grants, identities, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "grantee@x.com",
    });
    expect(r.ok).toBe(true);
    expect(audit.recorded()).toContainEqual({
      action: "grant.write.granted",
      orgId: ORG,
      actorUserId: OWNER,
      targetType: "report",
      targetId: reportId("00000000-0000-7000-8000-0000000000c1"),
      meta: { granteeEmail: "grantee@x.com", granteeUserId: OTHER_USER },
    });
  });

  it("audits the grantee EMAIL even when they haven't signed up (granteeUserId null)", async () => {
    // The trail must attribute a grant to a not-yet-registered invitee — the
    // exact case where granteeUserId is null (claude-review #177 finding 1).
    const { reports, grants, identities, audit, uow } = await seed();
    const r = await grantWrite({ reports, grants, identities, audit, uow }, ACTOR, {
      slug: SLUG as never,
      email: "newcomer@x.com",
    });
    expect(r.ok).toBe(true);
    expect(audit.recorded()).toContainEqual({
      action: "grant.write.granted",
      orgId: ORG,
      actorUserId: OWNER,
      targetType: "report",
      targetId: reportId("00000000-0000-7000-8000-0000000000c1"),
      meta: { granteeEmail: "newcomer@x.com", granteeUserId: null },
    });
  });
});

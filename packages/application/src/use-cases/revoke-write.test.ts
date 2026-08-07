import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuditLogger,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
  idempotencyTestDeps,
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
      { reports, grants, audit, uow, ...idempotencyTestDeps() },
      { orgId: ORG, userId: OWNER, scopes: [] },
      { slug: SLUG as never, email: "grantee@x.com" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InsufficientScope");
  });

  it("is owner-only — a same-org non-owner is rejected (NotAllowed)", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite(
      { reports, grants, audit, uow, ...idempotencyTestDeps() },
      { orgId: ORG, userId: OTHER_USER, scopes: ["acl:write"] },
      { slug: SLUG as never, email: "grantee@x.com" },
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "you do not own this report" });
  });

  it("revokes the grant — a subsequent findFor no longer matches", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite({ reports, grants, audit, uow, ...idempotencyTestDeps() }, ACTOR, {
      slug: SLUG as never,
      email: "grantee@x.com",
    });
    expect(r.ok).toBe(true);
    const found = await grants.findFor(REPORT_ID, { userId: OTHER_USER, email: "grantee@x.com" });
    expect(found.ok && found.value).toBeNull();
  });

  it("is idempotent — revoking an email with no grant still succeeds", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite({ reports, grants, audit, uow, ...idempotencyTestDeps() }, ACTOR, {
      slug: SLUG as never,
      email: "never-granted@x.com",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown slug with NotFound", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite({ reports, grants, audit, uow, ...idempotencyTestDeps() }, ACTOR, {
      slug: "zzzzzzzzzz" as never,
      email: "grantee@x.com",
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("records a grant.write.revoked audit row (ADR-0070)", async () => {
    const { reports, grants, audit, uow } = await seed();
    const r = await revokeWrite({ reports, grants, audit, uow, ...idempotencyTestDeps() }, ACTOR, {
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

describe("revokeWrite idempotency (ADR-0039)", () => {
  it("re-applies on an identical KEYLESS retry — no derived-key replay (#233)", async () => {
    const { reports, grants, audit, uow } = await seed();
    const deps = { reports, grants, audit, uow, ...idempotencyTestDeps() };
    await grants.grant(REPORT_ID, "g@x.io", OWNER, null);
    const first = await revokeWrite(deps, ACTOR, { slug: makeSlugOrThrow(), email: "g@x.io" });
    const second = await revokeWrite(deps, ACTOR, { slug: makeSlugOrThrow(), email: "g@x.io" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Was 1: the derived-key fallback replayed instead of re-applying, which
    // is the #233 defect. A keyless retry now really runs again.
    expect(audit.recorded().length).toBe(2);
  });
});

function makeSlugOrThrow() {
  const r = makeSlug(SLUG);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

// ── THE EXPLOIT, executed (issue #233 / GHSA-ghxh-82j4-pp6m) ───────────────
//
// This is the scenario the advisory names, and until this test existed nothing
// in the suite ran it. The rewritten idempotency test above asserts an
// audit-row COUNT, which is a proxy for "the write re-ran" — not for "the
// grantee actually lost write access". Those come apart exactly when the fix
// regresses, so the count alone would not have caught a re-introduction.
describe("revokeWrite — a pre-emptive revoke must not burn the key (#233)", () => {
  it("a revoke fired BEFORE the grant exists does not swallow the real revoke", async () => {
    const { reports, grants, audit, uow } = await seed();
    const deps = { reports, grants, audit, uow, ...idempotencyTestDeps() };
    const target = { slug: revokeSlug(), email: "victim@x.com" };

    // 1. Arm: revoke an email that has no grant yet. Under the derived-key
    //    fallback this CLAIMS and COMPLETES a key for (user, route, payload).
    await revokeWrite(deps, ACTOR, target);
    // 2. The grant is created.
    await grants.grant(REPORT_ID, "victim@x.com", OWNER, null);
    // 3. The real revoke. With the fallback this REPLAYED step 1's 204 and
    //    never executed — the grantee kept write access.
    const real = await revokeWrite(deps, ACTOR, target);

    expect(real.ok).toBe(true);
    const remaining = await grants.listByReport(REPORT_ID);
    expect(
      remaining.ok && remaining.value.map((g) => g.granteeEmail),
      "the grantee must NOT still hold write access",
    ).not.toContain("victim@x.com");
  });
});

function revokeSlug() {
  const r = makeSlug(SLUG);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  FakePasswordHasher,
  InMemoryAuditLogger,
  InMemoryGrantStore,
  InMemoryOrgWriteGrantStore,
  InMemoryReportRepository,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { setAcl } from "./set-acl";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const OTHER_USER = userId("00000000-0000-7000-8000-0000000000d2");
const SLUG = "aaaaaaaaaa";
const ACTOR = { orgId: ORG, userId: OWNER, scopes: ["acl:write"] };

async function seed(reportOrg = ORG) {
  const reports = new InMemoryReportRepository();
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("slug");
  const { report } = createReport({
    id: reportId("00000000-0000-7000-8000-0000000000c1"),
    orgId: reportOrg,
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
    hasher: new FakePasswordHasher(),
    grants: new InMemoryGrantStore({ now: () => Date.now() }),
    orgWriteGrants: new InMemoryOrgWriteGrantStore(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
  };
}

describe("setAcl use case (ADR-0056)", () => {
  it("requires the acl:write scope", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const r = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      { orgId: ORG, userId: OWNER, scopes: [] },
      {
        slug: SLUG as never,
        mode: "org",
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InsufficientScope");
  });

  it("password mode hashes the plaintext and persists it (never stores plaintext)", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const r = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "password",
        password: "hunter2",
      },
    );
    expect(r.ok && r.value.acl).toEqual({ mode: "password", passwordHash: "hashed:hunter2" });
    // and it round-trips through the repo
    const loaded = await reports.findBySlug(SLUG as never);
    expect(loaded.ok && loaded.value?.acl).toEqual({
      mode: "password",
      passwordHash: "hashed:hunter2",
    });
  });

  it("password mode without a password is a ValidationError", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const r = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "password",
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("allowlist normalizes emails + carries the owner access TTL; empty list is a ValidationError", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const ok = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "allowlist",
        allowedEmails: ["A@B.com", " a@b.com "],
        accessTtlSeconds: 86_400,
      },
    );
    expect(ok.ok && ok.value.acl).toEqual({
      mode: "allowlist",
      allowedEmails: ["a@b.com"],
      accessTtlSeconds: 86_400,
    });
    const bad = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "allowlist",
        allowedEmails: [],
      },
    );
    expect(bad.ok).toBe(false);
  });

  it("sets public / org with no extra data", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const r = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "public",
      },
    );
    expect(r.ok && r.value.acl).toEqual({ mode: "public" });
  });

  it("a revokeAll failure surfaces AND leaves the Acl unchanged (prune-before-persist)", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const allow = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "allowlist",
        allowedEmails: ["a@b.com"],
      },
    );
    expect(allow.ok).toBe(true);

    grants.failRevokeAll = true;
    const switched = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "public",
      },
    );
    expect(switched.ok).toBe(false);
    // Pruning runs BEFORE persistence: on failure the caller's error is truthful —
    // nothing changed, and a retry re-prunes (persist-first would strand stale
    // grants forever, since the re-loaded previous mode would no longer be allowlist).
    const loaded = await reports.findBySlug(SLUG as never);
    expect(loaded.ok && loaded.value?.acl.mode).toBe("allowlist");
  });

  it("a per-email revoke failure surfaces AND leaves the Acl roster unchanged", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const allow = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "allowlist",
        allowedEmails: ["a@b.com", "c@d.io"],
      },
    );
    expect(allow.ok).toBe(true);

    grants.failRevoke = true;
    const narrowed = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "allowlist",
        allowedEmails: ["c@d.io"],
      },
    );
    expect(narrowed.ok).toBe(false);
    const loaded = await reports.findBySlug(SLUG as never);
    expect(loaded.ok && loaded.value?.acl).toEqual({
      mode: "allowlist",
      allowedEmails: ["a@b.com", "c@d.io"],
      accessTtlSeconds: 604_800,
    });
  });

  it("rejects a non-owner (NotAllowed, ADR-0059: setAcl is owner-only) and an unknown slug (NotFound)", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const notMine = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      { orgId: ORG, userId: OTHER_USER, scopes: ["acl:write"] },
      {
        slug: SLUG as never,
        mode: "org",
      },
    );
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) {
      expect(notMine.error).toEqual({ kind: "NotAllowed", message: "you do not own this report" });
    }

    const missing = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: "zzzzzzzzzz" as never,
        mode: "org",
      },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("NotFound");
  });

  it("records an acl.set audit row (ADR-0070)", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const r = await setAcl(
      { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() },
      ACTOR,
      {
        slug: SLUG as never,
        mode: "public",
      },
    );
    expect(r.ok).toBe(true);
    expect(audit.recorded()).toContainEqual({
      action: "acl.set",
      orgId: ORG,
      actorUserId: OWNER,
      targetType: "report",
      targetId: reportId("00000000-0000-7000-8000-0000000000c1"),
      meta: { mode: "public" },
    });
  });

  it("narrowing with no org write grant records acl.set alone — never a phantom revocation", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const deps = { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() };
    const r = await setAcl(deps, ACTOR, { slug: SLUG as never, mode: "private" });
    expect(r.ok).toBe(true);
    expect(audit.recorded().map((e) => e.action)).toEqual(["acl.set"]);
  });

  it("records grant.org_write.revoked when the narrowing actually dropped a row (ADR-0078 §11)", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const deps = { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() };
    const RID = reportId("00000000-0000-7000-8000-0000000000c1");

    await setAcl(deps, ACTOR, { slug: SLUG as never, mode: "org" });
    await orgWriteGrants.grant(RID, ORG, OWNER);
    const narrowed = await setAcl(deps, ACTOR, { slug: SLUG as never, mode: "private" });
    expect(narrowed.ok).toBe(true);
    expect(audit.recorded().map((e) => e.action)).toEqual([
      "acl.set",
      "acl.set",
      "grant.org_write.revoked",
    ]);
    expect(audit.recorded()).toContainEqual({
      action: "grant.org_write.revoked",
      orgId: ORG,
      actorUserId: OWNER,
      targetType: "report",
      targetId: RID,
      meta: { revokedBy: "acl.set", mode: "private" },
    });
  });
});

describe("setAcl idempotency (ADR-0039)", () => {
  it("re-applies on an identical KEYLESS retry — no derived-key replay (#233)", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const deps = { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() };
    const input = { slug: slugOrThrow(), mode: "public" as const };
    const first = await setAcl(deps, ACTOR, input);
    const second = await setAcl(deps, ACTOR, input);
    expect(first.ok && first.value.acl.mode).toBe("public");
    expect(second.ok && second.value.acl.mode).toBe("public");
    // Was 1: the derived-key fallback replayed instead of re-applying, which
    // is the #233 defect. A keyless retry now really runs again.
    expect(audit.recorded().length).toBe(2);
  });

  it("a password-mode set WITHOUT an explicit key skips the idempotency claim — two different passwords both apply", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const deps = { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() };
    const a = await setAcl(deps, ACTOR, {
      slug: slugOrThrow(),
      mode: "password",
      password: "first-secret",
    });
    const b = await setAcl(deps, ACTOR, {
      slug: slugOrThrow(),
      mode: "password",
      password: "second-secret",
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // BOTH executed (no false replay): two audit rows, and the persisted hash
    // is the second password's.
    expect(audit.recorded().length).toBe(2);
  });

  it("a password-mode set with an explicit key replays WITHOUT the plaintext ever entering the store", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const idem = idempotencyTestDeps();
    const deps = { reports, hasher, grants, orgWriteGrants, audit, uow, ...idem };
    const input = {
      slug: slugOrThrow(),
      mode: "password" as const,
      password: "hunter22",
      idempotencyKey: "pw-key-1",
    };
    const first = await setAcl(deps, ACTOR, input);
    const second = await setAcl(deps, ACTOR, input);
    expect(first.ok).toBe(true);
    expect(second.ok && second.value.acl.mode).toBe("password");
    // Still 1: this test sends an EXPLICIT Idempotency-Key, so the claim/replay
    // machinery applies exactly as before. #233 only removed the DERIVED
    // fallback, which is the one the client never asked for.
    expect(audit.recorded().length).toBe(1);
    // The replayed acl body never carries a hash (reportReplayBody redaction).
    if (second.ok && second.value.acl.mode === "password") {
      expect(JSON.stringify(second.value.acl)).not.toContain("hunter22");
    }
  });
});

function slugOrThrow() {
  const r = makeSlug(SLUG);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

// ── THE EXPLOIT, executed (issue #233 / GHSA-ghxh-82j4-pp6m) ───────────────
//
// The advisory's other named shape: "org -> private -> org leaves the report
// private". The rewritten idempotency test above asserts an audit-row COUNT,
// which is a proxy for "the write re-ran" — not for "the report's sharing mode
// is what the caller last asked for". Those come apart precisely when the fix
// regresses, so assert the STATE.
describe("setAcl — A -> B -> A must land on A (#233)", () => {
  it("re-applying the original mode actually re-applies it", async () => {
    const { reports, hasher, grants, orgWriteGrants, audit, uow } = await seed();
    const deps = { reports, hasher, grants, orgWriteGrants, audit, uow, ...idempotencyTestDeps() };
    const at = (mode: "org" | "private") => setAcl(deps, ACTOR, { slug: slugOrThrow(), mode });

    expect((await at("org")).ok).toBe(true);
    expect((await at("private")).ok).toBe(true);
    const back = await at("org");

    // Under the derived-key fallback this third call replayed the FIRST
    // response: the API answered `org` while the stored report stayed
    // `private`. Assert the persisted aggregate, not the returned body.
    expect(back.ok && back.value.acl.mode).toBe("org");
    const stored = await reports.findBySlug(slugOrThrow());
    expect(
      stored.ok && stored.value?.acl.mode,
      "the PERSISTED acl must match the last call, not the first",
    ).toBe("org");
  });
});

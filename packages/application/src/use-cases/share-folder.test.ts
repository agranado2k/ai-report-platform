import { ACL_WRITE_SCOPE, folderId, orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { folder } from "../testing/fixtures";
import {
  InMemoryAuditLogger,
  InMemoryFolderRepository,
  InMemoryFolderShareStore,
  InMemoryIdentityStore,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { listFolderShares } from "./list-folder-shares";
import { shareFolder } from "./share-folder";
import { unshareFolder } from "./unshare-folder";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const me = userId("00000000-0000-7000-8000-0000000000d1");
const other = userId("00000000-0000-7000-8000-0000000000d2");
const F1 = "00000000-0000-7000-8000-0000000000f1";

const SCOPED = [ACL_WRITE_SCOPE];
const actorMe = { orgId: orgA, userId: me, scopes: SCOPED };

async function setup() {
  const folderShares = new InMemoryFolderShareStore();
  const identities = new InMemoryIdentityStore();
  const folders = new InMemoryFolderRepository(folderShares);
  await folders.save(folder(F1, orgA, "Mine", { ownerId: me, visibility: "private" }));
  return {
    folders,
    folderShares,
    identities,
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    ...idempotencyTestDeps(),
  };
}

describe("shareFolder use case (ADR-0076)", () => {
  it("the owner shares their folder; the share is listed with a normalized email", async () => {
    const d = await setup();
    const r = await shareFolder(d, actorMe, { folderId: folderId(F1), email: " Pal@Test.Local " });
    expect(r.ok && r.value.granteeEmail).toBe("pal@test.local");

    const listed = await listFolderShares(d, actorMe, { folderId: folderId(F1) });
    expect(listed.ok && listed.value.map((s) => s.granteeEmail)).toEqual(["pal@test.local"]);
  });

  it("resolves granteeUserId opportunistically when the grantee already exists", async () => {
    const d = await setup();
    d.identities.seedUser(other, "pal@test.local");
    const r = await shareFolder(d, actorMe, { folderId: folderId(F1), email: "pal@test.local" });
    expect(r.ok && r.value.granteeUserId).toBe(other);
  });

  it("requires the acl:write scope", async () => {
    const d = await setup();
    const r = await shareFolder(
      d,
      { ...actorMe, scopes: [] },
      { folderId: folderId(F1), email: "pal@test.local" },
    );
    expect(!r.ok && r.error.kind).toBe("InsufficientScope");
  });

  it("denies a non-owner (share management is owner-or-legacy only)", async () => {
    const d = await setup();
    // Make the folder visible to `other` (org) but still owned by `me`.
    const f = await d.folders.findById(folderId(F1));
    if (!f.ok || !f.value) throw new Error("setup failed");
    await d.folders.save({ ...f.value, visibility: "org" });
    const r = await shareFolder(
      d,
      { orgId: orgA, userId: other, scopes: SCOPED },
      { folderId: folderId(F1), email: "pal@test.local" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an invalid email (ValidationError)", async () => {
    const d = await setup();
    const r = await shareFolder(d, actorMe, { folderId: folderId(F1), email: "not-an-email" });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("records a folder.shared audit entry (ADR-0070)", async () => {
    const d = await setup();
    const r = await shareFolder(d, actorMe, { folderId: folderId(F1), email: "pal@test.local" });
    expect(r.ok).toBe(true);
    expect(d.audit.recorded()).toContainEqual({
      action: "folder.shared",
      orgId: orgA,
      actorUserId: me,
      targetType: "folder",
      targetId: folderId(F1),
      meta: { granteeEmail: "pal@test.local", granteeUserId: null },
    });
  });

  it("re-sharing the same email is an upsert, not a duplicate (fresh keys)", async () => {
    const d = await setup();
    await shareFolder(d, actorMe, {
      folderId: folderId(F1),
      email: "pal@test.local",
      idempotencyKey: "k1",
    });
    const again = await shareFolder(d, actorMe, {
      folderId: folderId(F1),
      email: "PAL@test.local",
      idempotencyKey: "k2",
    });
    expect(again.ok).toBe(true);
    const listed = await listFolderShares(d, actorMe, { folderId: folderId(F1) });
    expect(listed.ok && listed.value).toHaveLength(1);
  });
});

describe("unshareFolder use case (ADR-0076)", () => {
  it("revokes a share; the grantee loses visibility", async () => {
    const d = await setup();
    await shareFolder(d, actorMe, { folderId: folderId(F1), email: "pal@test.local" });
    const r = await unshareFolder(d, actorMe, { folderId: folderId(F1), email: "Pal@Test.Local" });
    expect(r.ok).toBe(true);
    const listed = await listFolderShares(d, actorMe, { folderId: folderId(F1) });
    expect(listed.ok && listed.value).toEqual([]);
  });

  it("is idempotent — revoking an email with no share still succeeds", async () => {
    const d = await setup();
    const r = await unshareFolder(d, actorMe, { folderId: folderId(F1), email: "no@one.local" });
    expect(r.ok).toBe(true);
  });

  it("requires the acl:write scope", async () => {
    const d = await setup();
    const r = await unshareFolder(
      d,
      { ...actorMe, scopes: [] },
      { folderId: folderId(F1), email: "pal@test.local" },
    );
    expect(!r.ok && r.error.kind).toBe("InsufficientScope");
  });

  it("denies a non-owner (share management is owner-or-legacy only)", async () => {
    const d = await setup();
    const f = await d.folders.findById(folderId(F1));
    if (!f.ok || !f.value) throw new Error("setup failed");
    await d.folders.save({ ...f.value, visibility: "org" });
    const r = await unshareFolder(
      d,
      { orgId: orgA, userId: other, scopes: SCOPED },
      { folderId: folderId(F1), email: "pal@test.local" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an invalid email (ValidationError)", async () => {
    const d = await setup();
    const r = await unshareFolder(d, actorMe, { folderId: folderId(F1), email: "not-an-email" });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("replays the recorded 204 on an identical retry with an EXPLICIT key — one audit row", async () => {
    const d = await setup();
    await shareFolder(d, actorMe, { folderId: folderId(F1), email: "pal@test.local" });
    const input = { folderId: folderId(F1), email: "pal@test.local", idempotencyKey: "k1" };
    expect((await unshareFolder(d, actorMe, input)).ok).toBe(true);
    expect((await unshareFolder(d, actorMe, input)).ok).toBe(true);
    expect(d.audit.recorded().filter((a) => a.action === "folder.unshared").length).toBe(1);
  });

  it("a pre-emptive unshare does NOT burn the key: a later real revoke still deletes (F1)", async () => {
    const d = await setup();
    // Revoke first (nothing to remove), then share, then revoke for real. With a
    // derived-key fallback the third call would replay the first 204 and leave
    // the grantee with visibility.
    await unshareFolder(d, actorMe, { folderId: folderId(F1), email: "pal@test.local" });
    await shareFolder(d, actorMe, { folderId: folderId(F1), email: "pal@test.local" });
    const revoked = await unshareFolder(d, actorMe, {
      folderId: folderId(F1),
      email: "pal@test.local",
    });
    expect(revoked.ok).toBe(true);
    const listed = await listFolderShares(d, actorMe, { folderId: folderId(F1) });
    expect(listed.ok && listed.value).toEqual([]);
  });

  it("records a folder.unshared audit entry (ADR-0070)", async () => {
    const d = await setup();
    const r = await unshareFolder(d, actorMe, { folderId: folderId(F1), email: "pal@test.local" });
    expect(r.ok).toBe(true);
    expect(d.audit.recorded()).toContainEqual({
      action: "folder.unshared",
      orgId: orgA,
      actorUserId: me,
      targetType: "folder",
      targetId: folderId(F1),
      meta: { granteeEmail: "pal@test.local" },
    });
  });
});

describe("listFolderShares authz (ADR-0076)", () => {
  it("requires the acl:write scope", async () => {
    const d = await setup();
    const r = await listFolderShares(d, { ...actorMe, scopes: [] }, { folderId: folderId(F1) });
    expect(!r.ok && r.error.kind).toBe("InsufficientScope");
  });

  it("denies a non-owner (share management is owner-or-legacy only)", async () => {
    const d = await setup();
    const f = await d.folders.findById(folderId(F1));
    if (!f.ok || !f.value) throw new Error("setup failed");
    await d.folders.save({ ...f.value, visibility: "org" });
    const r = await listFolderShares(
      d,
      { orgId: orgA, userId: other, scopes: SCOPED },
      { folderId: folderId(F1) },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });
});

describe("shareFolder idempotency (ADR-0039)", () => {
  it("replays the recorded share on an identical retry with an EXPLICIT key — one audit row", async () => {
    const d = await setup();
    const input = { folderId: folderId(F1), email: "pal@test.local", idempotencyKey: "k1" };
    const first = await shareFolder(d, actorMe, input);
    const second = await shareFolder(d, actorMe, input);
    expect(first.ok && first.value.granteeEmail).toBe("pal@test.local");
    expect(second.ok && second.value.granteeEmail).toBe("pal@test.local");
    expect(d.audit.recorded().length).toBe(1);
  });

  it("grant → revoke → re-grant restores the share (no derived-key replay, F1)", async () => {
    const d = await setup();
    const share = { folderId: folderId(F1), email: "pal@test.local" };
    await shareFolder(d, actorMe, share);
    await unshareFolder(d, actorMe, share);
    const again = await shareFolder(d, actorMe, share);
    expect(again.ok).toBe(true);
    const listed = await listFolderShares(d, actorMe, { folderId: folderId(F1) });
    expect(listed.ok && listed.value.map((s) => s.granteeEmail)).toEqual(["pal@test.local"]);
  });
});

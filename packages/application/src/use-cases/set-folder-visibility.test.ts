import { ACL_WRITE_SCOPE, folderId, orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { folder, makeFolderAccessDeps } from "../testing/fixtures";
import {
  InMemoryAuditLogger,
  InMemoryFolderRepository,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { setFolderVisibility } from "./set-folder-visibility";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const me = userId("00000000-0000-7000-8000-0000000000d1");
const other = userId("00000000-0000-7000-8000-0000000000d2");
const F1 = "00000000-0000-7000-8000-0000000000f1";
const ROOT = "00000000-0000-7000-8000-0000000000a0";

const SCOPED = [ACL_WRITE_SCOPE];

async function setup() {
  const access = makeFolderAccessDeps();
  const folders = new InMemoryFolderRepository(access.folderShares);
  await folders.save(folder(ROOT, orgA, "Root")); // legacy root: owner null, org
  return {
    folders,
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    ...access,
    ...idempotencyTestDeps(),
  };
}

describe("setFolderVisibility use case (ADR-0076)", () => {
  it("the owner flips their folder private → org and back", async () => {
    const d = await setup();
    await d.folders.save(folder(F1, orgA, "Mine", { ownerId: me, visibility: "private" }));
    const r = await setFolderVisibility(
      d,
      { orgId: orgA, userId: me, scopes: SCOPED },
      { folderId: folderId(F1), visibility: "org" },
    );
    expect(r.ok && r.value.visibility).toBe("org");
    const reloaded = await d.folders.findById(folderId(F1));
    expect(reloaded.ok && reloaded.value?.visibility).toBe("org");
  });

  it("ADOPTS a legacy folder: the caller becomes owner when setting private (the repair path)", async () => {
    const d = await setup();
    await d.folders.save(folder(F1, orgA, "Engineering", { parentId: folderId(ROOT) })); // legacy: owner null, org
    const r = await setFolderVisibility(
      d,
      { orgId: orgA, userId: me, scopes: SCOPED },
      { folderId: folderId(F1), visibility: "private" },
    );
    expect(r.ok && r.value.ownerId).toBe(me);
    expect(r.ok && r.value.visibility).toBe("private");
  });

  it("requires the acl:write scope", async () => {
    const d = await setup();
    await d.folders.save(folder(F1, orgA, "Mine", { ownerId: me, visibility: "private" }));
    const r = await setFolderVisibility(
      d,
      { orgId: orgA, userId: me, scopes: [] },
      { folderId: folderId(F1), visibility: "org" },
    );
    expect(!r.ok && r.error.kind).toBe("InsufficientScope");
  });

  it("denies a non-owner on an owned folder (NotAllowed)", async () => {
    const d = await setup();
    await d.folders.save(folder(F1, orgA, "Team", { ownerId: other, visibility: "org" }));
    const r = await setFolderVisibility(
      d,
      { orgId: orgA, userId: me, scopes: SCOPED },
      { folderId: folderId(F1), visibility: "private" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects making the Root private (root-always-org invariant)", async () => {
    const d = await setup();
    const r = await setFolderVisibility(
      d,
      { orgId: orgA, userId: me, scopes: SCOPED },
      { folderId: folderId(ROOT), visibility: "private" },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("records a folder.visibility_set audit entry with the adoption flag (ADR-0070)", async () => {
    const d = await setup();
    await d.folders.save(folder(F1, orgA, "Engineering", { parentId: folderId(ROOT) }));
    const r = await setFolderVisibility(
      d,
      { orgId: orgA, userId: me, scopes: SCOPED },
      { folderId: folderId(F1), visibility: "private" },
    );
    expect(r.ok).toBe(true);
    expect(d.audit.recorded()).toContainEqual({
      action: "folder.visibility_set",
      orgId: orgA,
      actorUserId: me,
      targetType: "folder",
      targetId: folderId(F1),
      meta: { from: "org", to: "private", adopted: true },
    });
  });
});

describe("setFolderVisibility idempotency (ADR-0039)", () => {
  it("replays the recorded folder resource on an identical retry — one audit row", async () => {
    const d = await setup();
    await d.folders.save(folder(F1, orgA, "Mine", { ownerId: me, visibility: "private" }));
    const actor = { orgId: orgA, userId: me, scopes: SCOPED };
    const input = { folderId: folderId(F1), visibility: "org" as const };
    const first = await setFolderVisibility(d, actor, input);
    const second = await setFolderVisibility(d, actor, input);
    expect(first.ok && first.value.visibility).toBe("org");
    expect(second.ok && second.value.visibility).toBe("org");
    expect(d.audit.recorded().length).toBe(1);
  });
});

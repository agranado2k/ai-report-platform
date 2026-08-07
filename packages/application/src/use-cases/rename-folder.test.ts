import {
  createFolder,
  type Folder,
  type FolderVisibility,
  folderId,
  orgId,
  userId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { makeFolderAccessDeps } from "../testing/fixtures";
import {
  InMemoryAuditLogger,
  InMemoryFolderRepository,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { renameFolder } from "./rename-folder";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const actorA = userId("00000000-0000-7000-8000-0000000000d1");

function folder(
  id: string,
  org: typeof orgA,
  name: string,
  ownerId: ReturnType<typeof userId> | null = null,
  visibility: FolderVisibility = "org",
): Folder {
  const r = createFolder({
    id: folderId(id),
    orgId: org,
    parentId: null,
    ownerId,
    visibility,
    name,
  });
  if (!r.ok) throw new Error("bad folder");
  return r.value;
}

const F1 = "00000000-0000-7000-8000-0000000000f1";

async function setup() {
  const access = makeFolderAccessDeps();
  const folders = new InMemoryFolderRepository(access.folderShares);
  await folders.save(folder(F1, orgA, "Old Name"));
  return {
    folders,
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    ...access,
    ...idempotencyTestDeps(),
  };
}

describe("renameFolder use case", () => {
  it("renames a folder in the same org and persists it", async () => {
    const { folders, ...deps } = await setup();
    const r = await renameFolder(
      { folders, ...deps },
      { orgId: orgA, userId: actorA },
      { folderId: folderId(F1), name: "New Name" },
    );
    expect(r.ok && r.value.name).toBe("New Name");
    const reloaded = await folders.findById(folderId(F1));
    expect(reloaded.ok && reloaded.value?.name).toBe("New Name");
  });

  it("rejects a cross-org folder with NotAllowed", async () => {
    const { folders, ...deps } = await setup();
    const r = await renameFolder(
      { folders, ...deps },
      { orgId: orgB, userId: actorA },
      { folderId: folderId(F1), name: "X" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an unknown folder with NotFound", async () => {
    const { folders, ...deps } = await setup();
    const r = await renameFolder(
      { folders, ...deps },
      { orgId: orgA, userId: actorA },
      { folderId: folderId("00000000-0000-7000-8000-00000000dead"), name: "X" },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects an empty name with ValidationError", async () => {
    const { folders, ...deps } = await setup();
    const r = await renameFolder(
      { folders, ...deps },
      { orgId: orgA, userId: actorA },
      { folderId: folderId(F1), name: "  " },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("records a folder.renamed audit entry alongside the rename (ADR-0070)", async () => {
    const { folders, audit, uow, folderShares, identities } = await setup();
    const r = await renameFolder(
      { folders, audit, uow, folderShares, identities, ...idempotencyTestDeps() },
      { orgId: orgA, userId: actorA },
      { folderId: folderId(F1), name: "New Name" },
    );
    expect(r.ok).toBe(true);
    expect(audit.recorded()).toContainEqual({
      action: "folder.renamed",
      orgId: orgA,
      actorUserId: actorA,
      targetType: "folder",
      targetId: folderId(F1),
      meta: { from: "Old Name", to: "New Name" },
    });
  });
});

describe("renameFolder visibility scoping (ADR-0076)", () => {
  const otherUser = userId("00000000-0000-7000-8000-0000000000d2");
  const F2 = "00000000-0000-7000-8000-0000000000f2";

  it("the owner renames their own private folder", async () => {
    const d = await setup();
    await d.folders.save(folder(F2, orgA, "Mine", actorA, "private"));
    const r = await renameFolder(
      d,
      { orgId: orgA, userId: actorA },
      { folderId: folderId(F2), name: "Still mine" },
    );
    expect(r.ok && r.value.name).toBe("Still mine");
  });

  it("another user's PRIVATE folder reads NotFound — existence is private", async () => {
    const d = await setup();
    await d.folders.save(folder(F2, orgA, "Theirs", otherUser, "private"));
    const r = await renameFolder(
      d,
      { orgId: orgA, userId: actorA },
      { folderId: folderId(F2), name: "X" },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("a share-visible private folder is NOT renameable — shares grant visibility only", async () => {
    const d = await setup();
    await d.folders.save(folder(F2, orgA, "Theirs", otherUser, "private"));
    await d.folderShares.grant(folderId(F2), "viewer@test.local", otherUser, actorA);
    const r = await renameFolder(
      d,
      { orgId: orgA, userId: actorA },
      { folderId: folderId(F2), name: "X" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
    expect(!r.ok && r.error.message).toBe("you do not have write access to this folder");
  });

  it("an org-visible folder owned by someone else stays renameable (today's behavior)", async () => {
    const d = await setup();
    await d.folders.save(folder(F2, orgA, "Team space", otherUser, "org"));
    const r = await renameFolder(
      d,
      { orgId: orgA, userId: actorA },
      { folderId: folderId(F2), name: "Renamed by colleague" },
    );
    expect(r.ok).toBe(true);
  });
});

describe("renameFolder idempotency (ADR-0039)", () => {
  it("re-applies on an identical KEYLESS retry — no derived-key replay (#233)", async () => {
    const { folders, ...deps } = await setup();
    const full = { folders, ...deps };
    const actor = { orgId: orgA, userId: actorA };
    const input = { folderId: folderId(F1), name: "New Name" };
    const first = await renameFolder(full, actor, input);
    const second = await renameFolder(full, actor, input);
    expect(first.ok && first.value.name).toBe("New Name");
    expect(second.ok && second.value.name).toBe("New Name");
    // #233: was 1, when the derived-key fallback replayed instead of
    // re-applying. The retry now really runs — same end state (these are
    // naturally idempotent), one more audit row. An explicit
    // Idempotency-Key still claims and replays exactly as before.
    expect(deps.audit.recorded().length).toBe(2);
  });
});

// ── #233 acceptance: the round-trip, not the audit count ───────────────────
describe("renameFolder — A -> B -> A must land on A (#233)", () => {
  it("re-applying the original name actually re-persists it", async () => {
    const deps = await setup();
    const { folders } = deps;
    const actor = { orgId: orgA, userId: actorA };
    const at = (name: string) => renameFolder(deps, actor, { folderId: folderId(F1), name });

    expect((await at("A")).ok).toBe(true);
    expect((await at("B")).ok).toBe(true);
    const back = await at("A");

    expect(back.ok && back.value.name).toBe("A");
    const stored = await folders.findById(folderId(F1));
    expect(stored.ok && stored.value?.name, "the PERSISTED name must be the last one set").toBe(
      "A",
    );
  });
});

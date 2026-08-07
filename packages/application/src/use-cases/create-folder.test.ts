import { createFolder as buildFolder, folderId, orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { makeFolderAccessDeps } from "../testing/fixtures";
import {
  InMemoryAuditLogger,
  InMemoryFolderRepository,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
  SequentialIdGenerator,
} from "../testing/in-memory";
import { createFolder, MAX_FOLDER_DEPTH } from "./create-folder";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const rootA = folderId("00000000-0000-7000-8000-0000000000a0");
const rootB = folderId("00000000-0000-7000-8000-0000000000b0");
const actorA = userId("00000000-0000-7000-8000-0000000000d1");
const otherUser = userId("00000000-0000-7000-8000-0000000000d2");

/** A folder one level under org A's Root — `private` by the ADR-0076 default,
 *  so inheritance tests can start from either visibility. */
async function makeParent(d: Awaited<ReturnType<typeof setup>>) {
  const parent = await createFolder(
    d,
    { orgId: orgA, userId: actorA },
    { parentId: rootA, name: "Parent" },
  );
  if (!parent.ok) throw new Error("setup failed");
  return parent.value;
}

/** A fresh fake with each org's Root seeded (as identity provisioning would). */
async function setup() {
  const access = makeFolderAccessDeps();
  const folders = new InMemoryFolderRepository(access.folderShares);
  for (const [org, id] of [
    [orgA, rootA],
    [orgB, rootB],
  ] as const) {
    // Roots as identity provisioning creates them: legacy owner, org-visible.
    const root = buildFolder({
      id,
      orgId: org,
      parentId: null,
      ownerId: null,
      visibility: "org",
      name: "Root",
    });
    if (!root.ok) throw new Error("seed failed");
    await folders.save(root.value);
  }
  return {
    folders,
    ids: new SequentialIdGenerator(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    ...access,
    ...idempotencyTestDeps(),
  };
}

describe("createFolder use case", () => {
  it("creates a folder under the org Root and persists it", async () => {
    const d = await setup();
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: rootA, name: "Archive" },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      orgId: orgA,
      parentId: rootA,
      name: "Archive",
      slug: "archive",
    });

    const list = await d.folders.listByOrg(orgA, { userId: actorA });
    expect(list.ok && list.value.map((f) => f.slug)).toContain("archive");
  });

  it("creates a nested folder under a non-Root parent", async () => {
    const d = await setup();
    const y = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: rootA, name: "2024" },
    );
    if (!y.ok) throw new Error("setup failed");
    const q = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: y.value.id, name: "Q1" },
    );
    expect(q.ok && q.value.parentId).toBe(y.value.id);
  });

  it("owns the new folder by its creator and defaults PRIVATE under the Root (ADR-0076)", async () => {
    const d = await setup();
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: rootA, name: "Mine" },
    );
    expect(r.ok && r.value.ownerId).toBe(actorA);
    expect(r.ok && r.value.visibility).toBe("private");
  });

  it("a child of a PRIVATE non-root folder inherits private (ADR-0076)", async () => {
    const d = await setup();
    const parent = await makeParent(d); // private — it is a child of the Root
    const child = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: parent.id, name: "Child" },
    );
    expect(child.ok && child.value.visibility).toBe("private");
  });

  it("a child of an ORG-VISIBLE non-root folder inherits org (ADR-0076)", async () => {
    const d = await setup();
    const parent = await makeParent(d);
    await d.folders.save({ ...parent, visibility: "org" });
    const child = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: parent.id, name: "Child" },
    );
    expect(child.ok && child.value.visibility).toBe("org");
  });

  it("rejects creating inside another user's PRIVATE folder as NotFound — not resolvable (ADR-0076)", async () => {
    const d = await setup();
    const theirs = await createFolder(
      d,
      { orgId: orgA, userId: otherUser },
      { parentId: rootA, name: "Theirs" },
    );
    if (!theirs.ok) throw new Error("setup failed");
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: theirs.value.id, name: "Sneaky" },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("allows creating inside another user's ORG-VISIBLE folder (today's behavior kept)", async () => {
    const d = await setup();
    const theirs = await createFolder(
      d,
      { orgId: orgA, userId: otherUser },
      { parentId: rootA, name: "Shared space" },
    );
    if (!theirs.ok) throw new Error("setup failed");
    await d.folders.save({ ...theirs.value, visibility: "org" });
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: theirs.value.id, name: "Sub" },
    );
    expect(r.ok).toBe(true);
  });

  it("a share-visible private parent is still NOT writable — shares grant visibility only (ADR-0076)", async () => {
    const d = await setup();
    const theirs = await createFolder(
      d,
      { orgId: orgA, userId: otherUser },
      { parentId: rootA, name: "Peek only" },
    );
    if (!theirs.ok) throw new Error("setup failed");
    await d.folderShares.grant(theirs.value.id, "a@test.local", otherUser, actorA);
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: theirs.value.id, name: "Nope" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
    expect(!r.ok && r.error.message).toBe("you do not have write access to the parent folder");
  });

  it("rejects nesting under another org's folder (NotAllowed)", async () => {
    const d = await setup();
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: rootB, name: "Mine" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects a non-existent parent (NotFound)", async () => {
    const d = await setup();
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: folderId("00000000-0000-7000-8000-00000000dead"), name: "X" },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects a soft-deleted parent (NotFound) — issue #132", async () => {
    const d = await setup();
    const old = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: rootA, name: "Old" },
    );
    if (!old.ok) throw new Error("setup failed");
    await d.folders.softDelete(old.value.id);

    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: old.value.id, name: "Child" },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
    expect(!r.ok && r.error.message).toBe("parent folder not found");
  });

  it("rejects a duplicate sibling slug (ValidationError)", async () => {
    const d = await setup();
    await createFolder(d, { orgId: orgA, userId: actorA }, { parentId: rootA, name: "Docs" });
    const dup = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: rootA, name: "docs" },
    );
    expect(!dup.ok && dup.error.kind).toBe("ValidationError");
  });

  it("rejects an empty name (ValidationError)", async () => {
    const d = await setup();
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: rootA, name: "   " },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it(`enforces max nesting depth ${MAX_FOLDER_DEPTH} (Root = 0)`, async () => {
    const d = await setup();
    // Nest MAX_FOLDER_DEPTH folders under Root (depths 1..MAX) — all allowed.
    let parent = rootA;
    for (let depth = 1; depth <= MAX_FOLDER_DEPTH; depth += 1) {
      const r = await createFolder(
        d,
        { orgId: orgA, userId: actorA },
        { parentId: parent, name: `level${depth}` },
      );
      expect(r.ok, `depth ${depth} should be allowed`).toBe(true);
      if (!r.ok) return;
      parent = r.value.id;
    }
    // The next one (depth MAX+1) is rejected.
    const tooDeep = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: parent, name: "tooDeep" },
    );
    expect(!tooDeep.ok && tooDeep.error.kind).toBe("ValidationError");
  });

  it("records a folder.created audit entry alongside the create (ADR-0070)", async () => {
    const d = await setup();
    const r = await createFolder(
      d,
      { orgId: orgA, userId: actorA },
      { parentId: rootA, name: "Archive" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(d.audit.recorded()).toContainEqual({
      action: "folder.created",
      orgId: orgA,
      actorUserId: actorA,
      targetType: "folder",
      targetId: r.value.id,
      meta: { parentId: rootA },
    });
  });
});

describe("createFolder idempotency (ADR-0039)", () => {
  // This use case is classified `sound`: the payload identifies the REQUEST,
  // so a retry is a duplicate and replaying it is the guarantee. #233 removed
  // the derived fallback only where it identifies desired STATE.
  it("REPLAYS an identical keyless retry — the derived key is what makes a retry safe (#233: sound)", async () => {
    const d = await setup();
    const actor = { orgId: orgA, userId: actorA };
    const input = { parentId: rootA, name: "Quarterly" };
    const first = await createFolder(d, actor, input);
    const second = await createFolder(d, actor, input);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(second.value.id).toBe(first.value.id); // same folder, not a sibling clash
    const list = await d.folders.listByOrg(orgA, { userId: actorA });
    expect(list.ok && list.value.filter((f) => f.name === "Quarterly").length).toBe(1);
  });

  it("a fresh explicit Idempotency-Key deliberately creates a second same-named folder attempt", async () => {
    const d = await setup();
    const actor = { orgId: orgA, userId: actorA };
    const first = await createFolder(d, actor, {
      parentId: rootA,
      name: "Twice",
      idempotencyKey: "k1",
    });
    const second = await createFolder(d, actor, {
      parentId: rootA,
      name: "Twice",
      idempotencyKey: "k2",
    });
    expect(first.ok).toBe(true);
    // A fresh key means NO replay: the second call really executed — and hit
    // the real sibling-slug uniqueness guard, exactly as a deliberate
    // duplicate-create should. (A replay would have returned the 201 body.)
    expect(!second.ok && second.error.kind).toBe("ValidationError");
  });
});

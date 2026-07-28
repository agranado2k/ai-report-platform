import { createFolder as buildFolder, folderId, orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuditLogger,
  InMemoryFolderRepository,
  PassThroughUnitOfWork,
  SequentialIdGenerator,
} from "../testing/in-memory";
import { createFolder, MAX_FOLDER_DEPTH } from "./create-folder";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const rootA = folderId("00000000-0000-7000-8000-0000000000a0");
const rootB = folderId("00000000-0000-7000-8000-0000000000b0");
const actorA = userId("00000000-0000-7000-8000-0000000000d1");

/** A fresh fake with each org's Root seeded (as identity provisioning would). */
async function setup() {
  const folders = new InMemoryFolderRepository();
  for (const [org, id] of [
    [orgA, rootA],
    [orgB, rootB],
  ] as const) {
    const root = buildFolder({ id, orgId: org, parentId: null, name: "Root" });
    if (!root.ok) throw new Error("seed failed");
    await folders.save(root.value);
  }
  return {
    folders,
    ids: new SequentialIdGenerator(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
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

    const list = await d.folders.listByOrg(orgA);
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

import { folderId, orgId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryFolderRepository, SequentialIdGenerator } from "../testing/in-memory";
import { createFolder } from "./create-folder";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");

function deps() {
  return { folders: new InMemoryFolderRepository(), ids: new SequentialIdGenerator() };
}

describe("createFolder use case", () => {
  it("creates a top-level folder in the actor's org and persists it", async () => {
    const d = deps();
    const r = await createFolder(d, { orgId: orgA }, { parentId: null, name: "Archive" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      orgId: orgA,
      parentId: null,
      name: "Archive",
      slug: "archive",
    });

    const list = await d.folders.listByOrg(orgA);
    expect(list.ok && list.value.map((f) => f.slug)).toContain("archive");
  });

  it("creates a nested folder under a parent in the same org", async () => {
    const d = deps();
    const parent = await createFolder(d, { orgId: orgA }, { parentId: null, name: "2024" });
    if (!parent.ok) throw new Error("setup failed");

    const child = await createFolder(d, { orgId: orgA }, { parentId: parent.value.id, name: "Q1" });
    expect(child.ok && child.value.parentId).toBe(parent.value.id);
  });

  it("rejects nesting under another org's folder (NotAllowed)", async () => {
    const d = deps();
    const foreign = await createFolder(d, { orgId: orgB }, { parentId: null, name: "Theirs" });
    if (!foreign.ok) throw new Error("setup failed");

    const r = await createFolder(d, { orgId: orgA }, { parentId: foreign.value.id, name: "Mine" });
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects a non-existent parent (NotFound)", async () => {
    const d = deps();
    const r = await createFolder(
      d,
      { orgId: orgA },
      { parentId: folderId("00000000-0000-7000-8000-00000000dead"), name: "X" },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects a duplicate sibling slug (ValidationError)", async () => {
    const d = deps();
    await createFolder(d, { orgId: orgA }, { parentId: null, name: "Docs" });
    const dup = await createFolder(d, { orgId: orgA }, { parentId: null, name: "docs" }); // same slug
    expect(!dup.ok && dup.error.kind).toBe("ValidationError");
  });

  it("rejects an empty name (ValidationError)", async () => {
    const d = deps();
    const r = await createFolder(d, { orgId: orgA }, { parentId: null, name: "   " });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });
});

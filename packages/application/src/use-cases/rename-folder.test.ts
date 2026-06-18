import { createFolder, type Folder, folderId, orgId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryFolderRepository } from "../testing/in-memory";
import { renameFolder } from "./rename-folder";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");

function folder(id: string, org: typeof orgA, name: string): Folder {
  const r = createFolder({ id: folderId(id), orgId: org, parentId: null, name });
  if (!r.ok) throw new Error("bad folder");
  return r.value;
}

const F1 = "00000000-0000-7000-8000-0000000000f1";

async function setup() {
  const folders = new InMemoryFolderRepository();
  await folders.save(folder(F1, orgA, "Old Name"));
  return { folders };
}

describe("renameFolder use case", () => {
  it("renames a folder in the same org and persists it", async () => {
    const { folders } = await setup();
    const r = await renameFolder(
      { folders },
      { orgId: orgA },
      { folderId: folderId(F1), name: "New Name" },
    );
    expect(r.ok && r.value.name).toBe("New Name");
    const reloaded = await folders.findById(folderId(F1));
    expect(reloaded.ok && reloaded.value?.name).toBe("New Name");
  });

  it("rejects a cross-org folder with NotAllowed", async () => {
    const { folders } = await setup();
    const r = await renameFolder(
      { folders },
      { orgId: orgB },
      { folderId: folderId(F1), name: "X" },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an unknown folder with NotFound", async () => {
    const { folders } = await setup();
    const r = await renameFolder(
      { folders },
      { orgId: orgA },
      { folderId: folderId("00000000-0000-7000-8000-00000000dead"), name: "X" },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects an empty name with ValidationError", async () => {
    const { folders } = await setup();
    const r = await renameFolder(
      { folders },
      { orgId: orgA },
      { folderId: folderId(F1), name: "  " },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });
});

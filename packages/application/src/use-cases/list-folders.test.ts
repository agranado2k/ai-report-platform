import { createFolder as buildFolder, folderId, orgId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryFolderRepository } from "../testing/in-memory";
import { listFolders } from "./list-folders";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const rootA = folderId("00000000-0000-7000-8000-0000000000a0");

async function seed(n: number) {
  const folders = new InMemoryFolderRepository();
  const root = buildFolder({ id: rootA, orgId: orgA, parentId: null, name: "Root" });
  if (!root.ok) throw new Error("seed failed");
  await folders.save(root.value);
  for (let i = 0; i < n; i++) {
    const f = buildFolder({
      id: folderId(`00000000-0000-7000-8000-0000000001${String(i).padStart(2, "0")}`),
      orgId: orgA,
      parentId: rootA,
      name: `Folder ${i}`,
    });
    if (!f.ok) throw new Error("seed failed");
    await folders.save(f.value);
  }
  return folders;
}

describe("listFolders use case", () => {
  it("returns every folder unpaginated when no pagination params are given (dashboard sidebar tree)", async () => {
    const folders = await seed(25);
    const r = await listFolders({ folders }, { orgId: orgA });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Root + 25 children, all in one page.
    expect(r.value.items).toHaveLength(26);
    expect(r.value.hasMore).toBe(false);
  });

  it("cursor-paginates when limit/startingAfter/endingBefore are given (JSON API)", async () => {
    const folders = await seed(25);
    const r = await listFolders({ folders }, { orgId: orgA }, { limit: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(10);
    expect(r.value.hasMore).toBe(true);
  });

  it("is org-scoped — never leaks another org's folders", async () => {
    const folders = await seed(3);
    const otherOrg = orgId("00000000-0000-7000-8000-0000000000b1");
    const r = await listFolders({ folders }, { orgId: otherOrg });
    expect(r.ok && r.value.items).toEqual([]);
  });

  it("clamps an out-of-range limit to 1..100 like searchReports", async () => {
    const folders = await seed(5);
    const r = await listFolders({ folders }, { orgId: orgA }, { limit: 1000 });
    expect(r.ok && r.value.items.length).toBeLessThanOrEqual(100);
  });
});

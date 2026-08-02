import {
  createFolder as buildFolder,
  type FolderVisibility,
  folderId,
  orgId,
  userId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryFolderRepository,
  InMemoryFolderShareStore,
  InMemoryIdentityStore,
} from "../testing/in-memory";
import { listFolders } from "./list-folders";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const rootA = folderId("00000000-0000-7000-8000-0000000000a0");
const me = userId("00000000-0000-7000-8000-0000000000d1");
const colleague = userId("00000000-0000-7000-8000-0000000000d2");

async function seed(n: number) {
  const shares = new InMemoryFolderShareStore();
  const folders = new InMemoryFolderRepository(shares);
  const identities = new InMemoryIdentityStore();
  const root = buildFolder({
    id: rootA,
    orgId: orgA,
    parentId: null,
    ownerId: null,
    visibility: "org",
    name: "Root",
  });
  if (!root.ok) throw new Error("seed failed");
  await folders.save(root.value);
  for (let i = 0; i < n; i++) {
    const f = buildFolder({
      id: folderId(`00000000-0000-7000-8000-0000000001${String(i).padStart(2, "0")}`),
      orgId: orgA,
      parentId: rootA,
      ownerId: null, // legacy shape — visible to everyone, like pre-ADR-0076 rows
      visibility: "org",
      name: `Folder ${i}`,
    });
    if (!f.ok) throw new Error("seed failed");
    await folders.save(f.value);
  }
  return { folders, shares, identities };
}

async function addOwned(
  d: Awaited<ReturnType<typeof seed>>,
  id: string,
  owner: typeof me,
  visibility: FolderVisibility,
  name: string,
) {
  const f = buildFolder({
    id: folderId(id),
    orgId: orgA,
    parentId: rootA,
    ownerId: owner,
    visibility,
    name,
  });
  if (!f.ok) throw new Error("seed failed");
  await d.folders.save(f.value);
  return f.value;
}

describe("listFolders use case", () => {
  it("returns every folder unpaginated when no pagination params are given (dashboard sidebar tree)", async () => {
    const d = await seed(25);
    const r = await listFolders(d, { orgId: orgA, userId: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Root + 25 children, all in one page.
    expect(r.value.items).toHaveLength(26);
    expect(r.value.hasMore).toBe(false);
  });

  it("cursor-paginates when limit/startingAfter/endingBefore are given (JSON API)", async () => {
    const d = await seed(25);
    const r = await listFolders(d, { orgId: orgA, userId: me }, { limit: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(10);
    expect(r.value.hasMore).toBe(true);
  });

  it("is org-scoped — never leaks another org's folders", async () => {
    const d = await seed(3);
    const otherOrg = orgId("00000000-0000-7000-8000-0000000000b1");
    const r = await listFolders(d, { orgId: otherOrg, userId: me });
    expect(r.ok && r.value.items).toEqual([]);
  });

  it("clamps an out-of-range limit to 1..100 like searchReports", async () => {
    const d = await seed(5);
    const r = await listFolders(d, { orgId: orgA, userId: me }, { limit: 1000 });
    expect(r.ok && r.value.items.length).toBeLessThanOrEqual(100);
  });
});

describe("listFolders visibility scoping (ADR-0076)", () => {
  const PRIV = "00000000-0000-7000-8000-0000000000f1";

  it("a colleague's PRIVATE folder is absent; their org-visible one is listed", async () => {
    const d = await seed(0);
    await addOwned(d, PRIV, colleague, "private", "Their private");
    await addOwned(d, "00000000-0000-7000-8000-0000000000f2", colleague, "org", "Their shared");
    const r = await listFolders(d, { orgId: orgA, userId: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.value.items.map((f) => f.name);
    expect(names).not.toContain("Their private");
    expect(names).toContain("Their shared");
    expect(names).toContain("Root"); // root-always-visible
  });

  it("the owner always lists their own private folder", async () => {
    const d = await seed(0);
    await addOwned(d, PRIV, me, "private", "Mine");
    const r = await listFolders(d, { orgId: orgA, userId: me });
    expect(r.ok && r.value.items.map((f) => f.name)).toContain("Mine");
  });

  it("a folder share by USER ID makes a private folder visible", async () => {
    const d = await seed(0);
    const f = await addOwned(d, PRIV, colleague, "private", "Shared to me");
    await d.shares.grant(f.id, "unrelated@test.local", colleague, me);
    const r = await listFolders(d, { orgId: orgA, userId: me });
    expect(r.ok && r.value.items.map((x) => x.name)).toContain("Shared to me");
  });

  it("a folder share by EMAIL (grantee not yet resolved) makes it visible", async () => {
    const d = await seed(0);
    const f = await addOwned(d, PRIV, colleague, "private", "Shared by email");
    d.identities.seedUser(me, "Me@Test.Local"); // resolved + normalized at check time
    await d.shares.grant(f.id, "me@test.local", colleague, null);
    const r = await listFolders(d, { orgId: orgA, userId: me });
    expect(r.ok && r.value.items.map((x) => x.name)).toContain("Shared by email");
  });
});

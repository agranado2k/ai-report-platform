// Integration tests for DrizzleFolderRepository against real Postgres (pglite) —
// exercises the actual SQL + the sibling-slug unique constraint mapping.
import { createFolder, type Folder, folderId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleFolderRepository } from "./folder-repository";
import { makeTestDb, type SeededIdentity, seedIdentity, type TestDb } from "./testing/pglite";

describe("DrizzleFolderRepository (pglite integration)", () => {
  let tdb: TestDb;
  let repo: DrizzleFolderRepository;
  let ids: SeededIdentity;

  beforeEach(async () => {
    tdb = await makeTestDb();
    ids = await seedIdentity(tdb.ctx); // seeds the org + a Root folder
    repo = new DrizzleFolderRepository(tdb.ctx);
  });
  afterEach(() => tdb.close());

  function build(id: string, name: string): Folder {
    const r = createFolder({ id: folderId(id), orgId: ids.orgId, parentId: ids.folderId, name });
    if (!r.ok) throw new Error("bad test folder");
    return r.value;
  }

  it("saves a folder and lists it for the org", async () => {
    const saved = await repo.save(build("00000000-0000-4000-8000-0000000000c1", "Archive"));
    expect(saved.ok).toBe(true);

    const list = await repo.listByOrg(ids.orgId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.map((f) => f.slug)).toContain("archive");
  });

  it("finds a saved folder by id", async () => {
    const f = build("00000000-0000-4000-8000-0000000000c2", "Docs");
    await repo.save(f);
    const found = await repo.findById(f.id);
    expect(found.ok && found.value?.name).toBe("Docs");
    expect(found.ok && found.value?.parentId).toBe(ids.folderId);
  });

  it("rejects a duplicate sibling slug with a ValidationError", async () => {
    await repo.save(build("00000000-0000-4000-8000-0000000000c3", "Reports"));
    const dup = await repo.save(build("00000000-0000-4000-8000-0000000000c4", "reports")); // same slug, same parent
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.kind).toBe("ValidationError");
  });
});

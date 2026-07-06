// Runs the shared FolderRepository contract (arp-application/testing) against
// DrizzleFolderRepository on pglite (ADR-0046) — the same suite that runs
// against InMemoryFolderRepository in packages/application/src/testing/
// contracts/folder-repository.contract.test.ts.
import { describeFolderRepositoryContract } from "arp-application/testing";
import { createFolder, folderId } from "arp-domain";
import { DrizzleFolderRepository } from "./folder-repository";
import { makeTestDb, seedIdentity } from "./testing/pglite";

/** A deterministic UUIDv7-shaped id, distinct from + sorting after
 *  seedIdentity()'s fixed Root folder constant (the real `uuid` column needs
 *  valid UUID text; the fixed prefix keeps ordering predictable). */
function folderIdFixture(n: number) {
  return folderId(`30000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`);
}

describeFolderRepositoryContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx); // seeds the org + a Root folder
  const repo = new DrizzleFolderRepository(tdb.ctx);
  let seq = 0;

  return {
    repo,
    orgId: ids.orgId,
    rootFolderId: ids.folderId,
    makeFolder(overrides = {}) {
      seq += 1;
      const built = createFolder({
        id: overrides.id ?? folderIdFixture(seq),
        orgId: ids.orgId,
        parentId: overrides.parentId === undefined ? ids.folderId : overrides.parentId,
        name: overrides.name ?? `Folder ${seq}`,
      });
      if (!built.ok) throw new Error(`bad contract-test folder: ${built.error.message}`);
      return built.value;
    },
    async teardown() {
      await tdb.close();
    },
  };
});

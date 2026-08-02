// Runs the shared FolderRepository contract (arp-application/testing) against
// DrizzleFolderRepository on pglite (ADR-0046) — the same suite that runs
// against InMemoryFolderRepository in packages/application/src/testing/
// contracts/folder-repository.contract.test.ts. The ADR-0076 visibility matrix
// exercises the real SQL predicate (owner / legacy / org / folder-share EXISTS).
import { describeFolderRepositoryContract } from "arp-application/testing";
import { createFolder, folderId } from "arp-domain";
import { DrizzleFolderRepository } from "./folder-repository";
import { DrizzleFolderShareStore } from "./folder-share-store";
import { makeTestDb, seedColleague, seedIdentity } from "./testing/pglite";

/** A deterministic UUIDv7-shaped id, distinct from + sorting after
 *  seedIdentity()'s fixed Root folder constant (the real `uuid` column needs
 *  valid UUID text; the fixed prefix keeps ordering predictable). */
function folderIdFixture(n: number) {
  return folderId(`30000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`);
}

describeFolderRepositoryContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx); // seeds the org + a Root folder
  const colleague = await seedColleague(tdb.ctx); // a second real users row
  const repo = new DrizzleFolderRepository(tdb.ctx);
  const shares = new DrizzleFolderShareStore(tdb.ctx);
  let seq = 0;

  return {
    repo,
    orgId: ids.orgId,
    rootFolderId: ids.folderId,
    ownerUserId: ids.userId,
    colleagueUserId: colleague.userId,
    shares,
    makeFolder(overrides = {}) {
      seq += 1;
      const built = createFolder({
        id: overrides.id ?? folderIdFixture(seq),
        orgId: ids.orgId,
        parentId: overrides.parentId === undefined ? ids.folderId : overrides.parentId,
        ownerId: overrides.ownerId ?? null, // legacy default (pre-ADR-0076 shape)
        visibility: overrides.visibility ?? "org",
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

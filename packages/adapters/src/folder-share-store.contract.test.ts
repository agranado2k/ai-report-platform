// Runs the shared FolderShareStore contract (arp-application/testing) against
// DrizzleFolderShareStore on pglite (ADR-0076, ADR-0046) — the same suite that
// runs against InMemoryFolderShareStore in packages/application/src/testing/
// contracts/folder-share-store.contract.test.ts. Exercises the real
// `folder_shares` FKs (folder + users rows must exist).
import { describeFolderShareStoreContract } from "arp-application/testing";
import { DrizzleFolderShareStore } from "./folder-share-store";
import { makeTestDb, seedIdentity, seedSecondFolder } from "./testing/pglite";

describeFolderShareStoreContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx); // seeds the org + user + Root folder
  return {
    store: new DrizzleFolderShareStore(tdb.ctx),
    folderId: ids.folderId, // the seeded Root — a real FK target
    otherFolderId: await seedSecondFolder(tdb.ctx),
    existingUserId: ids.userId,
    async teardown() {
      await tdb.close();
    },
  };
});

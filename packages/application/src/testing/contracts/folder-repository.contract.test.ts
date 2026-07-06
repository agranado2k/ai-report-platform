// Runs the shared FolderRepository contract against InMemoryFolderRepository.
// The same suite also runs against DrizzleFolderRepository on pglite from
// packages/adapters/src/folder-repository.contract.test.ts (ADR-0046).
import { createFolder, folderId, orgId } from "arp-domain";
import { InMemoryFolderRepository } from "../in-memory";
import { describeFolderRepositoryContract } from "./folder-repository.contract";

const ORG_ID = orgId("contract-org");
// UUID-shaped and lexicographically smaller than any generated fixture id below
// (all-zero suffix), so keyset-pagination ordering agrees with the Drizzle+pglite
// harness, where the seeded Root folder's id is likewise the earliest.
const ROOT_FOLDER_ID = folderId("00000000-0000-4000-8000-000000000000");

describeFolderRepositoryContract("in-memory", async () => {
  const repo = new InMemoryFolderRepository();
  await repo.save({
    id: ROOT_FOLDER_ID,
    orgId: ORG_ID,
    parentId: null,
    name: "Root",
    slug: "root",
    deletedAt: null,
  });
  let seq = 0;

  return {
    repo,
    orgId: ORG_ID,
    rootFolderId: ROOT_FOLDER_ID,
    makeFolder(overrides = {}) {
      seq += 1;
      const built = createFolder({
        // Hex like the adapter harness's fixture ids, so both contract runs
        // order identically past seq 9.
        id:
          overrides.id ?? folderId(`00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`),
        orgId: ORG_ID,
        parentId: overrides.parentId === undefined ? ROOT_FOLDER_ID : overrides.parentId,
        name: overrides.name ?? `Folder ${seq}`,
      });
      if (!built.ok) throw new Error(`bad contract-test folder: ${built.error.message}`);
      return built.value;
    },
    async teardown() {},
  };
});

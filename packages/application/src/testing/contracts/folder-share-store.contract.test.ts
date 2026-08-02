// Runs the shared FolderShareStore contract against InMemoryFolderShareStore.
// The same suite also runs against DrizzleFolderShareStore on pglite from
// packages/adapters/src/folder-share-store.contract.test.ts (ADR-0076, ADR-0046).
import { folderId, userId } from "arp-domain";
import { InMemoryFolderShareStore } from "../in-memory";
import { describeFolderShareStoreContract } from "./folder-share-store.contract";

const FOLDER_ID = folderId("contract-folder");
const OTHER_FOLDER_ID = folderId("contract-folder-2");
const EXISTING_USER_ID = userId("contract-owner");

describeFolderShareStoreContract("in-memory", async () => ({
  store: new InMemoryFolderShareStore(),
  folderId: FOLDER_ID,
  otherFolderId: OTHER_FOLDER_ID,
  existingUserId: EXISTING_USER_ID,
  async teardown() {},
}));

// renameFolder — change a Folder's display name in the acting org (ADR-0036,
// Reports & Folders). Pure orchestration over FolderRepository (ADR-0024):
// load+authz (the shared loadOwnedFolder guard) → apply the domain rename
// transition (name only; slug stays stable) → persist via save.
import {
  type AppError,
  renameFolder as applyRename,
  type Folder,
  type FolderId,
  type OrgId,
  ok,
  type Result,
} from "arp-domain";
import { loadOwnedFolder } from "../load-owned";
import type { FolderRepository } from "../ports";

export interface RenameFolderDeps {
  readonly folders: FolderRepository;
}
export interface RenameFolderActor {
  readonly orgId: OrgId;
}
export interface RenameFolderInput {
  readonly folderId: FolderId;
  readonly name: string;
}

export async function renameFolder(
  deps: RenameFolderDeps,
  actor: RenameFolderActor,
  input: RenameFolderInput,
): Promise<Result<Folder, AppError>> {
  const found = await loadOwnedFolder(deps.folders, actor, input.folderId);
  if (!found.ok) return found;

  const renamed = applyRename(found.value, input.name);
  if (!renamed.ok) return renamed;

  const saved = await deps.folders.save(renamed.value);
  if (!saved.ok) return saved;
  return ok(renamed.value);
}

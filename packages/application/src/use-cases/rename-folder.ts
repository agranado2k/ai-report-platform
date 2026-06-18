// renameFolder — change a Folder's display name in the acting org (ADR-0036,
// Reports & Folders). Pure orchestration over FolderRepository (ADR-0024): load
// → authz (must exist, not be deleted, belong to the actor's org) → apply the
// domain rename transition (name only; slug stays stable) → persist via save.
import {
  type AppError,
  renameFolder as applyRename,
  err,
  type Folder,
  type FolderId,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type Result,
} from "arp-domain";
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
  const found = await deps.folders.findById(input.folderId);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound("folder not found"));
  if (found.value.orgId !== actor.orgId) return err(notAllowed("folder is not in your org"));

  const renamed = applyRename(found.value, input.name);
  if (!renamed.ok) return renamed;

  const saved = await deps.folders.save(renamed.value);
  if (!saved.ok) return saved;
  return ok(renamed.value);
}

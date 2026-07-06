// deleteFolder — soft-delete a Folder in the acting org (ADR-0036, Reports &
// Folders). Pure orchestration over the Folder + Report repositories (ADR-0024):
// load+authz (the shared loadOwnedFolder guard) → reject the Root → reject a
// non-empty folder (any subfolder or any report placed here) → softDelete.
// "Block if non-empty" is the chosen policy: the caller empties a folder (move
// its contents out) before deleting.
import {
  type AppError,
  err,
  type FolderId,
  type OrgId,
  type Result,
  validationError,
} from "arp-domain";
import { loadOwnedFolder } from "../load-owned";
import type { FolderRepository, ReportRepository } from "../ports";

export interface DeleteFolderDeps {
  readonly folders: FolderRepository;
  readonly reports: ReportRepository;
}
export interface DeleteFolderActor {
  readonly orgId: OrgId;
}
export interface DeleteFolderInput {
  readonly folderId: FolderId;
}

export async function deleteFolder(
  deps: DeleteFolderDeps,
  actor: DeleteFolderActor,
  input: DeleteFolderInput,
): Promise<Result<void, AppError>> {
  const found = await loadOwnedFolder(deps.folders, actor, input.folderId);
  if (!found.ok) return found;
  if (found.value.parentId === null) {
    return err(validationError("the Root folder cannot be deleted", "folderId"));
  }

  // Block if non-empty (ADR-0036): any subfolder or any report placed here.
  const folders = await deps.folders.listByOrg(actor.orgId);
  if (!folders.ok) return folders;
  if (folders.value.some((f) => f.parentId === input.folderId)) {
    return err(validationError("folder is not empty: it has subfolders", "folderId"));
  }
  const reports = await deps.reports.listByOrg(actor.orgId);
  if (!reports.ok) return reports;
  if (reports.value.some((r) => r.folderId === input.folderId)) {
    return err(
      validationError("folder is not empty: move or delete its reports first", "folderId"),
    );
  }

  return deps.folders.softDelete(input.folderId);
}

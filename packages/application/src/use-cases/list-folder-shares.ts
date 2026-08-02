// listFolderShares — everyone a Folder is shared with (ADR-0076).
// OWNER-OR-LEGACY only (loadManagedFolder) + the `acl:write` scope (ADR-0016)
// even on a GET — share config is the owner's business (mirrors
// listWriteGrants, ADR-0060). Pure orchestration; no idempotency (a read).
import {
  ACL_WRITE_SCOPE,
  type AppError,
  err,
  type FolderId,
  insufficientScope,
  type Result,
} from "arp-domain";
import { type FolderAccessDeps, loadManagedFolder, type TenancyActor } from "../load-owned";
import type { FolderRepository, FolderShare } from "../ports";

export interface ListFolderSharesDeps extends FolderAccessDeps {
  readonly folders: FolderRepository;
}

export interface ListFolderSharesActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface ListFolderSharesInput {
  readonly folderId: FolderId;
}

export async function listFolderShares(
  deps: ListFolderSharesDeps,
  actor: ListFolderSharesActor,
  input: ListFolderSharesInput,
): Promise<Result<readonly FolderShare[], AppError>> {
  if (!actor.scopes.includes(ACL_WRITE_SCOPE)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadManagedFolder(deps.folders, actor, input.folderId, deps);
  if (!found.ok) return found;

  return deps.folderShares.listByFolder(found.value.id);
}

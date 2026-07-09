// renameFolder — change a Folder's display name in the acting org (ADR-0036,
// Reports & Folders). Pure orchestration over FolderRepository (ADR-0024):
// load+authz (the shared loadOwnedFolder guard, OUTSIDE the tx) → apply the
// domain rename transition (name only; slug stays stable) → persist via save
// + a `folder.renamed` audit_log row (ADR-0070), committed together
// (ADR-0037 §5).
import {
  type AppError,
  renameFolder as applyRename,
  type Folder,
  type FolderId,
  ok,
  type Result,
} from "arp-domain";
import { loadOwnedFolder, type TenancyActor } from "../load-owned";
import type { AuditLogger, FolderRepository, UnitOfWork } from "../ports";

export interface RenameFolderDeps {
  readonly folders: FolderRepository;
  /** Audit log (ADR-0070) — one `folder.renamed` row per rename. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
/** Authz here keys ONLY on `orgId` (loadOwnedFolder) — `userId` is carried
 *  solely to attribute the audit row; it must never gate authorization. */
export type RenameFolderActor = TenancyActor;
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
  const fromName = found.value.name;

  const renamed = applyRename(found.value, input.name);
  if (!renamed.ok) return renamed;

  return deps.uow.run(async () => {
    const saved = await deps.folders.save(renamed.value);
    if (!saved.ok) return saved;
    const audited = await deps.audit.record([
      {
        action: "folder.renamed",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "folder",
        targetId: found.value.id,
        meta: { from: fromName, to: renamed.value.name },
      },
    ]);
    if (!audited.ok) return audited;
    return ok(renamed.value);
  });
}

// deleteFolder — soft-delete a Folder in the acting org (ADR-0036, Reports &
// Folders). Pure orchestration over the Folder + Report repositories (ADR-0024):
// load+authz (the shared loadWritableFolder guard, ADR-0076, OUTSIDE the tx)
// → reject the Root → reject a non-empty folder (any subfolder or any report
// placed here) → softDelete + a `folder.deleted` audit_log row (ADR-0070),
// committed together (ADR-0037 §5). "Block if non-empty" is the chosen policy:
// the caller empties a folder (move its contents out) before deleting. BOTH
// emptiness guards are deliberately NOT visibility-scoped (ADR-0075/0076): a
// subfolder or report the deleter cannot see must still block the delete, and
// a bare boolean surfaces no metadata.
import { type AppError, err, type FolderId, ok, type Result, validationError } from "arp-domain";
import { beginIdempotentWrite, type IdempotentWriteDeps } from "../idempotent-write";
import { type FolderAccessDeps, loadWritableFolder, type TenancyActor } from "../load-owned";
import type { AuditLogger, FolderRepository, ReportRepository, UnitOfWork } from "../ports";

const ROUTE = "DELETE /api/v1/folders/{id}";

export interface DeleteFolderDeps extends IdempotentWriteDeps, FolderAccessDeps {
  readonly folders: FolderRepository;
  readonly reports: ReportRepository;
  /** Audit log (ADR-0070) — one `folder.deleted` row per soft-delete. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
/** `userId` gates authorization (ADR-0076): private folders are deletable
 *  only by their owner. */
export type DeleteFolderActor = TenancyActor;
export interface DeleteFolderInput {
  readonly folderId: FolderId;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function deleteFolder(
  deps: DeleteFolderDeps,
  actor: DeleteFolderActor,
  input: DeleteFolderInput,
): Promise<Result<void, AppError>> {
  // Idempotency (ADR-0039), claimed BEFORE the load (same rationale as
  // deleteReport): a successful delete makes the retry's own load 404, so the
  // replay check must run first for the retry to see its recorded 204.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: delete-shaped; the key must not be burnable before the fact
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.folderId],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return ok(undefined);
  const idemRef = idem.value.ref;

  const found = await loadWritableFolder(deps.folders, actor, input.folderId, deps);
  if (!found.ok) return found;
  if (found.value.parentId === null) {
    return err(validationError("the Root folder cannot be deleted", "folderId"));
  }

  // Block if non-empty (ADR-0036): any subfolder or any report placed here.
  // Deliberately NOT visibility-scoped (ADR-0076, mirroring hasReportsInFolder):
  // an invisible subfolder must still block the delete.
  const hasChildren = await deps.folders.hasChildFolders(actor.orgId, input.folderId);
  if (!hasChildren.ok) return hasChildren;
  if (hasChildren.value) {
    return err(validationError("folder is not empty: it has subfolders", "folderId"));
  }
  // Deliberately NOT visibility-scoped (ADR-0075): a report the deleter can't
  // see must still block the delete — the boolean leaks no metadata.
  const hasReports = await deps.reports.hasReportsInFolder(actor.orgId, input.folderId);
  if (!hasReports.ok) return hasReports;
  if (hasReports.value) {
    return err(
      validationError("folder is not empty: move or delete its reports first", "folderId"),
    );
  }

  return deps.uow.run(async () => {
    const deleted = await deps.folders.softDelete(input.folderId);
    if (!deleted.ok) return deleted;
    const audited = await deps.audit.record([
      {
        action: "folder.deleted",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "folder",
        targetId: input.folderId,
      },
    ]);
    if (!audited.ok) return audited;
    // No ref when the client sent no Idempotency-Key: an `unsound` operation
    // claims nothing, so there is nothing to complete (issue #233).
    return idemRef
      ? deps.idempotency.complete(idemRef, { responseStatus: 204, responseBody: null })
      : ok(undefined);
  });
}

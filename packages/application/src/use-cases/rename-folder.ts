// renameFolder — change a Folder's display name in the acting org (ADR-0036,
// Reports & Folders). Pure orchestration over FolderRepository (ADR-0024):
// load+authz (the shared loadWritableFolder guard, ADR-0076: owner, or anyone
// for legacy/org-visible folders; an invisible folder reads NotFound; OUTSIDE
// the tx) → apply the domain rename transition (name only; slug stays stable)
// → persist via save + a `folder.renamed` audit_log row (ADR-0070), committed
// together (ADR-0037 §5).
import {
  type AppError,
  renameFolder as applyRename,
  type Folder,
  type FolderId,
  ok,
  type Result,
} from "arp-domain";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reviveFolderReplay,
} from "../idempotent-write";
import { type FolderAccessDeps, loadWritableFolder, type TenancyActor } from "../load-owned";
import type { AuditLogger, FolderRepository, UnitOfWork } from "../ports";

const ROUTE = "PATCH /api/v1/folders/{id}";

export interface RenameFolderDeps extends IdempotentWriteDeps, FolderAccessDeps {
  readonly folders: FolderRepository;
  /** Audit log (ADR-0070) — one `folder.renamed` row per rename. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
/** `userId` gates authorization (ADR-0076): private folders are renameable
 *  only by their owner. */
export type RenameFolderActor = TenancyActor;
export interface RenameFolderInput {
  readonly folderId: FolderId;
  readonly name: string;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function renameFolder(
  deps: RenameFolderDeps,
  actor: RenameFolderActor,
  input: RenameFolderInput,
): Promise<Result<Folder, AppError>> {
  const found = await loadWritableFolder(deps.folders, actor, input.folderId, deps);
  if (!found.ok) return found;
  const fromName = found.value.name;

  const renamed = applyRename(found.value, input.name);
  if (!renamed.ok) return renamed;

  // Idempotency (ADR-0039): explicit key, else derived from user+route+payload.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: sets the name; A -> B -> A must re-apply
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.folderId, input.name],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveFolderReplay(idem.value.record);
  const idemRef = idem.value.ref;

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
    // No ref when the client sent no Idempotency-Key: an `unsound` operation
    // claims nothing, so there is nothing to complete (issue #233).
    if (idemRef) {
      const done = await deps.idempotency.complete(idemRef, {
        responseStatus: 200,
        responseBody: renamed.value,
      });
      if (!done.ok) return done;
    }
    return ok(renamed.value);
  });
}

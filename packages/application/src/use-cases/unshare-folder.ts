// unshareFolder — revoke a folder share (ADR-0076). OWNER-OR-LEGACY only
// (loadManagedFolder) + the `acl:write` scope (ADR-0016). Idempotent by
// design (mirrors revokeWrite, ADR-0060): revoking an email with no share is
// a no-op success, so a client retry or a stale UI never surfaces a false
// failure. The revoke + the `folder.unshared` audit_log row (ADR-0070) commit
// together in one UnitOfWork (ADR-0037 §5).
import {
  ACL_WRITE_SCOPE,
  type AppError,
  err,
  type FolderId,
  insufficientScope,
  makeEmailAddress,
  ok,
  type Result,
} from "arp-domain";
import { beginIdempotentWrite, type IdempotentWriteDeps } from "../idempotent-write";
import { type FolderAccessDeps, loadManagedFolder, type TenancyActor } from "../load-owned";
import type { AuditLogger, FolderRepository, UnitOfWork } from "../ports";

const ROUTE = "DELETE /api/v1/folders/{id}/shares/{email}";

export interface UnshareFolderDeps extends IdempotentWriteDeps, FolderAccessDeps {
  readonly folders: FolderRepository;
  /** Audit log (ADR-0070) — one `folder.unshared` row per revoke. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

export interface UnshareFolderActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface UnshareFolderInput {
  readonly folderId: FolderId;
  readonly email: string;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function unshareFolder(
  deps: UnshareFolderDeps,
  actor: UnshareFolderActor,
  input: UnshareFolderInput,
): Promise<Result<void, AppError>> {
  if (!actor.scopes.includes(ACL_WRITE_SCOPE)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadManagedFolder(deps.folders, actor, input.folderId, deps);
  if (!found.ok) return found;

  const email = makeEmailAddress(input.email);
  if (!email.ok) return email;

  // Idempotency (ADR-0039): a replayed revoke returns the recorded 204.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    key: input.idempotencyKey,
    fingerprint: [input.folderId, email.value],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return ok(undefined);
  const idemRef = idem.value.ref;

  return deps.uow.run(async () => {
    const revoked = await deps.folderShares.revoke(found.value.id, email.value);
    if (!revoked.ok) return revoked;
    const audited = await deps.audit.record([
      {
        action: "folder.unshared",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "folder",
        targetId: found.value.id,
        meta: { granteeEmail: email.value },
      },
    ]);
    if (!audited.ok) return audited;
    return deps.idempotency.complete(idemRef, { responseStatus: 204, responseBody: null });
  });
}

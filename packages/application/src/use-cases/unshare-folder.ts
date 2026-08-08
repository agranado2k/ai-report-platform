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
  hasFolderManagementScope,
  insufficientScope,
  makeEmailAddress,
  ok,
  type Result,
} from "arp-domain";
import { commitWrite } from "../commit-write";
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
  if (!hasFolderManagementScope(actor.scopes)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadManagedFolder(deps.folders, actor, input.folderId, deps);
  if (!found.ok) return found;

  const email = makeEmailAddress(input.email);
  if (!email.ok) return email;

  // Idempotency (ADR-0039), with the setAcl-shaped carve-out: the DERIVED-key
  // fallback fingerprints (folder, grantee) — the state this call establishes,
  // not a one-shot request — and a derived key is permanent (`idempotency_keys`
  // has no TTL sweep today). So a PRE-EMPTIVE revoke (of an email with no
  // share) would burn the key, and the later REAL revoke would replay its 204
  // without deleting anything — the grantee silently keeps visibility. A delete
  // is already naturally idempotent (revoking nothing succeeds), so the
  // fallback buys nothing. With an EXPLICIT `Idempotency-Key` the client owns
  // retry identity and the recorded 204 replays as usual.
  // The carve-out is centralized in beginIdempotentWrite via
  // `derivedFallback` — no local guard, so there is only ONE place this
  // decision can be made or drift (issue #233).
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: delete-shaped (the #230 carve-out, now centralized)
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.folderId, email.value],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return ok(undefined);
  const idemRef = idem.value.ref;

  return commitWrite(
    deps,
    {
      idemRef,
      audit: () => [
        {
          action: "folder.unshared",
          orgId: actor.orgId,
          actorUserId: actor.userId,
          targetType: "folder",
          targetId: found.value.id,
          meta: { granteeEmail: email.value },
        },
      ],
      response: () => ({ responseStatus: 204, responseBody: null }),
    },
    async () => {
      const revoked = await deps.folderShares.revoke(found.value.id, email.value);
      return revoked.ok ? ok(undefined) : revoked;
    },
  );
}

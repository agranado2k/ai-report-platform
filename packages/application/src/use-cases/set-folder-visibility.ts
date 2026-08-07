// setFolderVisibility — flip a Folder between `private` and `org` (ADR-0076).
// OWNER-OR-LEGACY only (the shared loadManagedFolder guard): an owned folder's
// visibility is its owner's business; a legacy (ownerId null) folder is
// ADOPTED by the caller — setting its visibility assigns them as owner (the
// repair path for pre-ADR-0076 org-visible folders). Requires the `acl:write`
// scope (ADR-0016) — folder sharing gates on the SAME scope as report sharing:
// sharing is sharing. The Root is always `org` (domain-enforced invariant).
// Persists via save + a `folder.visibility_set` audit_log row (ADR-0070),
// committed together (ADR-0037 §5).
import {
  ACL_WRITE_SCOPE,
  type AppError,
  setFolderVisibility as applyVisibility,
  err,
  type Folder,
  type FolderId,
  type FolderVisibility,
  hasFolderManagementScope,
  insufficientScope,
  ok,
  type Result,
} from "arp-domain";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reviveFolderReplay,
} from "../idempotent-write";
import { type FolderAccessDeps, loadManagedFolder, type TenancyActor } from "../load-owned";
import type { AuditLogger, FolderRepository, IdempotencyKeyRef, UnitOfWork } from "../ports";

const ROUTE = "POST /api/v1/folders/{id}/visibility";

export interface SetFolderVisibilityDeps extends IdempotentWriteDeps, FolderAccessDeps {
  readonly folders: FolderRepository;
  /** Audit log (ADR-0070) — one `folder.visibility_set` row per change. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

export interface SetFolderVisibilityActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface SetFolderVisibilityInput {
  readonly folderId: FolderId;
  readonly visibility: FolderVisibility;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function setFolderVisibility(
  deps: SetFolderVisibilityDeps,
  actor: SetFolderVisibilityActor,
  input: SetFolderVisibilityInput,
): Promise<Result<Folder, AppError>> {
  if (!hasFolderManagementScope(actor.scopes)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadManagedFolder(deps.folders, actor, input.folderId, deps);
  if (!found.ok) return found;
  const fromVisibility = found.value.visibility;

  // Root-always-org + legacy adoption live in the domain transition.
  const changed = applyVisibility(found.value, input.visibility, actor.userId);
  if (!changed.ok) return changed;

  // Idempotency (ADR-0039), with the same carve-out shape setAcl uses for
  // password mode: the ADR-0039 DERIVED-key fallback is only sound for
  // operations whose fingerprint identifies a one-shot request. This one sets
  // STATE, so its fingerprint describes the DESIRED state — and a derived key
  // is a permanent record (`idempotency_keys` has no TTL sweep today), so
  // private → org → private would replay the first response and never re-save,
  // leaving the folder `org` while the API answered `private`. Setting the same
  // visibility twice is naturally idempotent in effect, so the fallback buys
  // nothing here. With an EXPLICIT `Idempotency-Key` the client owns retry
  // identity and the claim/replay machinery applies as usual.
  // The carve-out is centralized in beginIdempotentWrite via
  // `derivedFallback` — no local guard, so there is only ONE place this
  // decision can be made or drift (issue #233).
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: sets visibility STATE (the #230 carve-out, now centralized)
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.folderId, input.visibility],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveFolderReplay(idem.value.record);
  const idemRef = idem.value.ref;

  return deps.uow.run(async () => {
    const saved = await deps.folders.save(changed.value);
    if (!saved.ok) return saved;
    const audited = await deps.audit.record([
      {
        action: "folder.visibility_set",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "folder",
        targetId: found.value.id,
        meta: {
          from: fromVisibility,
          to: changed.value.visibility,
          // Record an adoption (legacy → owned by the caller) explicitly.
          adopted: found.value.ownerId === null,
        },
      },
    ]);
    if (!audited.ok) return audited;
    if (idemRef) {
      const done = await deps.idempotency.complete(idemRef, {
        responseStatus: 200,
        responseBody: changed.value,
      });
      if (!done.ok) return done;
    }
    return ok(changed.value);
  });
}

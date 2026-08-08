// shareFolder — grant another person VISIBILITY of a Folder by email
// (ADR-0076). Shares confer visibility ONLY — never rename/delete/create
// rights (those stay owner-or-org, `canWriteFolder`). OWNER-OR-LEGACY only
// (loadManagedFolder) + the `acl:write` scope (ADR-0016 — the same scope
// report sharing gates on: sharing is sharing), and NEVER the Root (ADR-0076
// §3 — it is a legacy row, so the guard passes it). Mirrors grantWrite (ADR-0060):
// normalize the grantee email → resolve `granteeUserId` opportunistically
// (IdentityStore — set now if the grantee already has an account, else left
// null and matched by email at check time) → upsert via FolderShareStore + a
// `folder.shared` audit_log row (ADR-0070), committed together (ADR-0037 §5)
// → return the canonical persisted share.

import {
  ACL_WRITE_SCOPE,
  type AppError,
  err,
  type FolderId,
  hasFolderManagementScope,
  insufficientScope,
  isRootFolder,
  makeEmailAddress,
  ok,
  type Result,
  validationError,
} from "arp-domain";
import { commitWrite } from "../commit-write";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reviveFolderShareReplay,
} from "../idempotent-write";
import { type FolderAccessDeps, loadManagedFolder, type TenancyActor } from "../load-owned";
import type {
  AuditLogger,
  FolderRepository,
  FolderShare,
  IdentityStore,
  UnitOfWork,
} from "../ports";

const ROUTE = "POST /api/v1/folders/{id}/shares";

export interface ShareFolderDeps extends IdempotentWriteDeps, FolderAccessDeps {
  readonly folders: FolderRepository;
  readonly identities: Pick<IdentityStore, "findEmailByUserId" | "findUserIdByEmail">;
  /** Audit log (ADR-0070) — one `folder.shared` row per share. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

export interface ShareFolderActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface ShareFolderInput {
  readonly folderId: FolderId;
  readonly email: string;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function shareFolder(
  deps: ShareFolderDeps,
  actor: ShareFolderActor,
  input: ShareFolderInput,
): Promise<Result<FolderShare, AppError>> {
  if (!hasFolderManagementScope(actor.scopes)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadManagedFolder(deps.folders, actor, input.folderId, deps);
  if (!found.ok) return found;
  // The Root is a legacy row (ownerId null), so `loadManagedFolder` PASSES it
  // — refuse it explicitly (ADR-0076 §3). Every member can already see the
  // Root, so a share on it is a no-op that nonetheless implies it is somebody's
  // to give away, and it is the one folder that must stay nobody's.
  if (isRootFolder(found.value)) {
    return err(
      validationError("the Root folder is visible to every member and cannot be shared", "id"),
    );
  }

  const email = makeEmailAddress(input.email);
  if (!email.ok) return email;

  // Opportunistic resolution (ADR-0060 §2 pattern): set granteeUserId now if
  // the grantee already has an account; else leave it null — the share still
  // matches by email at check time once they sign up.
  const granteeUserId = await deps.identities.findUserIdByEmail(email.value);
  if (!granteeUserId.ok) return granteeUserId;

  // Idempotency (ADR-0039), with the setAcl-shaped carve-out: the DERIVED-key
  // fallback fingerprints (folder, grantee) — the state this call establishes,
  // not a one-shot request — and a derived key is permanent (`idempotency_keys`
  // has no TTL sweep today). So grant → revoke → RE-grant would replay the
  // first 201 and never re-insert the share. An upsert of the same grant is
  // naturally idempotent, so the fallback buys nothing. With an EXPLICIT
  // `Idempotency-Key` the client owns retry identity and replay applies.
  // The carve-out is centralized in beginIdempotentWrite via
  // `derivedFallback` — no local guard, so there is only ONE place this
  // decision can be made or drift (issue #233).
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: sets a share STATE (the #230 carve-out, now centralized)
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.folderId, email.value],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveFolderShareReplay(idem.value.record);
  const idemRef = idem.value.ref;

  return commitWrite(
    deps,
    {
      idemRef,
      audit: () => [
        {
          action: "folder.shared",
          orgId: actor.orgId,
          actorUserId: actor.userId,
          targetType: "folder",
          targetId: found.value.id,
          // The email is the share key — granteeUserId is opportunistic (null
          // until the invitee signs up), same rationale as grantWrite's audit.
          meta: { granteeEmail: email.value, granteeUserId: granteeUserId.value },
        },
      ],
      response: (share) => ({ responseStatus: 201, responseBody: share }),
    },
    async () => {
      const shared = await deps.folderShares.grant(
        found.value.id,
        email.value,
        actor.userId,
        granteeUserId.value,
      );
      if (!shared.ok) return shared;

      // Re-read for the canonical persisted row (grantedAt is server-assigned),
      // inside the tx so the recorded replay body IS the committed row
      // (ADR-0039). It sits in the mutation closure rather than after the audit
      // because commitWrite derives BOTH the audit rows and the replay body
      // from what the mutation returns — the ordering within the transaction is
      // unchanged and neither step depends on the other.
      const listed = await deps.folderShares.listByFolder(found.value.id);
      if (!listed.ok) return listed;
      const share = listed.value.find((it) => it.granteeEmail === email.value);
      return share
        ? ok(share)
        : err({
            kind: "Unexpected" as const,
            message: "folder share not found immediately after sharing",
          });
    },
  );
}

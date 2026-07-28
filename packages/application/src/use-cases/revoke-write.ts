// revokeWrite — the report's OWNER revokes a write grant (ADR-0060 §3).
// OWNER-ONLY (ADR-0059 §2) + `acl:write` scope (ADR-0016). Idempotent by
// design (matches GrantStore.revoke's allowlist precedent) — revoking an
// email with no grant is a no-op success, not an error, so a client retry or
// a stale UI never surfaces a false failure. The revoke + the
// `grant.write.revoked` audit_log row (ADR-0070) commit together in one
// UnitOfWork (ADR-0037 §5).
import {
  type AppError,
  err,
  insufficientScope,
  makeEmailAddress,
  type Result,
  type Slug,
} from "arp-domain";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type { AuditLogger, ReportRepository, UnitOfWork, WriteGrantStore } from "../ports";

const ACL_WRITE_SCOPE = "acl:write";

export interface RevokeWriteDeps {
  readonly reports: ReportRepository;
  readonly grants: WriteGrantStore;
  /** Audit log (ADR-0070) — one `grant.write.revoked` row per revoke. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

export interface RevokeWriteActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface RevokeWriteInput {
  readonly slug: Slug;
  readonly email: string;
}

export async function revokeWrite(
  deps: RevokeWriteDeps,
  actor: RevokeWriteActor,
  input: RevokeWriteInput,
): Promise<Result<void, AppError>> {
  if (!actor.scopes.includes(ACL_WRITE_SCOPE)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!found.ok) return found;

  const email = makeEmailAddress(input.email);
  if (!email.ok) return email;

  return deps.uow.run(async () => {
    const revoked = await deps.grants.revoke(found.value.id, email.value);
    if (!revoked.ok) return revoked;
    return deps.audit.record([
      {
        action: "grant.write.revoked",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: found.value.id,
        // NOTE: unlike grantWrite, revokeWrite has no IdentityStore dep and
        // WriteGrantStore.revoke() doesn't return the grant row, so there's
        // no resolved UserId available here — the email is the actual revoke
        // key and the only grantee-identifying value on hand.
        meta: { granteeEmail: email.value },
      },
    ]);
  });
}

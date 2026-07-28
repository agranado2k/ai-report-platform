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
  ok,
  type Result,
  type Slug,
} from "arp-domain";
import { beginIdempotentWrite, type IdempotentWriteDeps } from "../idempotent-write";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type { AuditLogger, ReportRepository, UnitOfWork, WriteGrantStore } from "../ports";

const ACL_WRITE_SCOPE = "acl:write";
const ROUTE = "DELETE /api/v1/reports/{slug}/write-grants/{email}";

export interface RevokeWriteDeps extends IdempotentWriteDeps {
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
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
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

  // Idempotency (ADR-0039): a replayed revoke returns the recorded 204.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    key: input.idempotencyKey,
    fingerprint: [input.slug, email.value],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return ok(undefined);
  const idemRef = idem.value.ref;

  return deps.uow.run(async () => {
    const revoked = await deps.grants.revoke(found.value.id, email.value);
    if (!revoked.ok) return revoked;
    const audited = await deps.audit.record([
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
    if (!audited.ok) return audited;
    return deps.idempotency.complete(idemRef, { responseStatus: 204, responseBody: null });
  });
}

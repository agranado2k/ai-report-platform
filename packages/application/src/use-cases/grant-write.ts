// grantWrite — the report's OWNER grants another person write access (rename /
// re-upload / move — NOT delete / set_acl / grant management, ADR-0060 §3).
// OWNER-ONLY (ADR-0059 §2 — grant management stays with `loadOwnedReport`,
// never the `canWrite` seam it feeds) + the `acl:write` scope (ADR-0016, same
// scope `setAcl` requires — a write grant is share config). Pure orchestration
// (ADR-0024): scope → ownership → normalize+validate the grantee email →
// resolve `granteeUserId` opportunistically (IdentityStore, ADR-0060 §2 — set
// now if the grantee already has an account, else left null and matched by
// email at check time) → upsert via WriteGrantStore + a `grant.write.granted`
// audit_log row (ADR-0070), committed together in one UnitOfWork (ADR-0037 §5)
// → return the grant.
import {
  ACL_WRITE_SCOPE,
  type AppError,
  err,
  insufficientScope,
  makeEmailAddress,
  ok,
  type Result,
  type Slug,
} from "arp-domain";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reviveWriteGrantReplay,
} from "../idempotent-write";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type {
  AuditLogger,
  IdentityStore,
  ReportRepository,
  UnitOfWork,
  WriteGrant,
  WriteGrantStore,
} from "../ports";

const ROUTE = "POST /api/v1/reports/{slug}/write-grants";

export interface GrantWriteDeps extends IdempotentWriteDeps {
  readonly reports: ReportRepository;
  readonly grants: WriteGrantStore;
  readonly identities: Pick<IdentityStore, "findUserIdByEmail">;
  /** Audit log (ADR-0070) — one `grant.write.granted` row per grant. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

export interface GrantWriteActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface GrantWriteInput {
  readonly slug: Slug;
  readonly email: string;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function grantWrite(
  deps: GrantWriteDeps,
  actor: GrantWriteActor,
  input: GrantWriteInput,
): Promise<Result<WriteGrant, AppError>> {
  if (!actor.scopes.includes(ACL_WRITE_SCOPE)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!found.ok) return found;

  const email = makeEmailAddress(input.email);
  if (!email.ok) return email;

  // Opportunistic resolution (ADR-0060 §2): set granteeUserId now if the
  // grantee already has an account; else leave it null — the grant still
  // matches by email at check time once they sign up.
  const granteeUserId = await deps.identities.findUserIdByEmail(email.value);
  if (!granteeUserId.ok) return granteeUserId;

  // Idempotency (ADR-0039): explicit key, else derived from user+route+payload.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: sets grant STATE for an email; re-granting must re-apply
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.slug, email.value],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveWriteGrantReplay(idem.value.record);
  const idemRef = idem.value.ref;

  return deps.uow.run(async () => {
    const g = await deps.grants.grant(
      found.value.id,
      email.value,
      actor.userId,
      granteeUserId.value,
    );
    if (!g.ok) return g;
    const audited = await deps.audit.record([
      {
        action: "grant.write.granted",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: found.value.id,
        // Always record the grantee EMAIL (the grant key) — `granteeUserId` is
        // opportunistic (null until the invitee signs up, ADR-0060 §2), so the
        // email is the only attribution present for a grant to a not-yet-
        // registered user. Consistent with revoke-write's audit meta.
        meta: { granteeEmail: email.value, granteeUserId: granteeUserId.value },
      },
    ]);
    if (!audited.ok) return audited;

    // Re-read via listByReport for the canonical persisted row (grantedAt is
    // server-assigned) rather than constructing one client-side. Inside the
    // transaction so the recorded replay body IS the committed row (ADR-0039).
    const listed = await deps.grants.listByReport(found.value.id);
    if (!listed.ok) return listed;
    const grant = listed.value.find((it) => it.granteeEmail === email.value);
    if (!grant) {
      return err({
        kind: "Unexpected",
        message: "write grant not found immediately after granting",
      });
    }
    // No ref when the client sent no Idempotency-Key: an `unsound` operation
    // claims nothing, so there is nothing to complete (issue #233).
    if (idemRef) {
      const done = await deps.idempotency.complete(idemRef, {
        responseStatus: 201,
        responseBody: grant,
      });
      if (!done.ok) return done;
    }
    return ok(grant);
  });
}

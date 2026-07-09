// revokeApiKey — revoke an ApiKey the acting user owns (ADR-0008). Pure
// orchestration over the ApiKeyStore port (ADR-0024). The store's own
// `revoke` is idempotent and ownership-scoped: revoking someone else's key
// (or an already-revoked one) is a silent no-op, not an error — the
// settings page never needs to distinguish "not yours" from "already gone".
// The revoke + a `api_key.revoked` audit_log row (ADR-0070) commit together
// in one UnitOfWork (ADR-0037 section 5). `orgId` is on the actor (NOT the
// key, since a no-op revoke of someone else's/an already-revoked key must
// still resolve an org for the row -- `audit_log.org_id` is NOT NULL) so it
// carries the ACTOR's own org, mirroring every other audited actor here.
import type { AppError, OrgId, Result, UserId } from "arp-domain";
import type { ApiKeyStore, AuditLogger, UnitOfWork } from "../ports";

export interface RevokeApiKeyDeps {
  readonly apiKeys: ApiKeyStore;
  /** Audit log (ADR-0070) — one `api_key.revoked` row per revoke. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export interface RevokeApiKeyActor {
  readonly userId: UserId;
  readonly orgId: OrgId;
}
export interface RevokeApiKeyInput {
  readonly id: string;
}

export async function revokeApiKey(
  deps: RevokeApiKeyDeps,
  actor: RevokeApiKeyActor,
  input: RevokeApiKeyInput,
): Promise<Result<void, AppError>> {
  return deps.uow.run(async () => {
    const revoked = await deps.apiKeys.revoke(input.id, actor.userId);
    if (!revoked.ok) return revoked;
    return deps.audit.record([
      {
        action: "api_key.revoked",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "api_key",
        targetId: input.id,
      },
    ]);
  });
}

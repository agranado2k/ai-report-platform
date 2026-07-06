// revokeApiKey — revoke an ApiKey the acting user owns (ADR-0008). Pure
// orchestration over the ApiKeyStore port (ADR-0024). The store's own
// `revoke` is idempotent and ownership-scoped: revoking someone else's key
// (or an already-revoked one) is a silent no-op, not an error — the
// settings page never needs to distinguish "not yours" from "already gone".
import type { AppError, Result, UserId } from "arp-domain";
import type { ApiKeyStore } from "../ports";

export interface RevokeApiKeyDeps {
  readonly apiKeys: ApiKeyStore;
}
export interface RevokeApiKeyActor {
  readonly userId: UserId;
}
export interface RevokeApiKeyInput {
  readonly id: string;
}

export async function revokeApiKey(
  deps: RevokeApiKeyDeps,
  actor: RevokeApiKeyActor,
  input: RevokeApiKeyInput,
): Promise<Result<void, AppError>> {
  return deps.apiKeys.revoke(input.id, actor.userId);
}

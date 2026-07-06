// listApiKeys — the acting user's issued ApiKeys, newest first (ADR-0008,
// the settings/MCP-connect page). Pure orchestration over the ApiKeyStore
// port (ADR-0024); never returns the secret/hash, only the ApiKeySummary.
import type { AppError, Result, UserId } from "arp-domain";
import type { ApiKeyStore, ApiKeySummary } from "../ports";

export interface ListApiKeysDeps {
  readonly apiKeys: ApiKeyStore;
}
export interface ListApiKeysActor {
  readonly userId: UserId;
}

export async function listApiKeys(
  deps: ListApiKeysDeps,
  actor: ListApiKeysActor,
): Promise<Result<readonly ApiKeySummary[], AppError>> {
  return deps.apiKeys.listForUser(actor.userId);
}

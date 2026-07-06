// createApiKey — mint a new ApiKey for the acting user in their acting org
// (ADR-0008 / ADR-0016). Pure orchestration over the ApiKeyStore port
// (ADR-0024): trims + validates the name (blank → 422 instead of minting an
// unnamed key), defaults to the Phase-1 `reports:write` Scope when the
// caller doesn't override it. The secret is returned exactly once — the
// store never re-displays it (only the hashed/prefixed ApiKeySummary).
import {
  type AppError,
  err,
  type OrgId,
  type Result,
  type UserId,
  validationError,
} from "arp-domain";
import type { ApiKeyStore, ApiKeySummary } from "../ports";

/** The only Scope the settings UI offers today (ADR-0016). */
const DEFAULT_SCOPES: readonly string[] = ["reports:write"];

export interface CreateApiKeyDeps {
  readonly apiKeys: ApiKeyStore;
}
export interface CreateApiKeyActor {
  readonly userId: UserId;
  readonly orgId: OrgId;
}
export interface CreateApiKeyInput {
  readonly name: string;
  readonly scopes?: readonly string[];
}

export async function createApiKey(
  deps: CreateApiKeyDeps,
  actor: CreateApiKeyActor,
  input: CreateApiKeyInput,
): Promise<Result<{ readonly token: string; readonly summary: ApiKeySummary }, AppError>> {
  const name = input.name.trim();
  if (!name) return err(validationError("give your key a name", "name"));

  return deps.apiKeys.create({
    actingUserId: actor.userId,
    issuedInOrgId: actor.orgId,
    name,
    scopes: input.scopes ?? DEFAULT_SCOPES,
  });
}

// authenticateApiKey — resolve a presented `arp_` API key into the SAME UploadActor
// the Clerk-session path yields (ADR-0008), so the two auth schemes stay
// interchangeable behind the seam. Pure orchestration over the ApiKeyStore port
// (ADR-0024): the resolved principal's org Root folder becomes the Phase-1 write
// default (ADR-0048), and scopes come from the key row (ADR-0016) — not hardcoded.
// Returns ok(null) when the token matches no live key (the seam maps that to 401
// on a write, or an empty list on a read).
import { type AppError, ok, type Result } from "arp-domain";
import type { ApiKeyStore } from "../ports";
import type { UploadActor } from "./upload-report";

export interface AuthenticateApiKeyDeps {
  readonly apiKeys: ApiKeyStore;
}

export async function authenticateApiKey(
  deps: AuthenticateApiKeyDeps,
  token: string,
): Promise<Result<UploadActor | null, AppError>> {
  const resolved = await deps.apiKeys.verify(token);
  if (!resolved.ok) return resolved;
  if (!resolved.value) return ok(null);

  const p = resolved.value;
  return ok({
    userId: p.userId,
    orgId: p.orgId,
    folderId: p.rootFolderId,
    scopes: p.scopes,
  });
}

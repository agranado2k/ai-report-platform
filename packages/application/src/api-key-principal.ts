// principalToUploadActor — the pure ApiKeyPrincipal → UploadActor mapping at
// the auth seam. The key's org Root folder becomes the actor's write target
// (`folderId`, the Phase-1 default — ADR-0048); `scopes` pass through from the
// key row (ADR-0016), never hardcoded. Kept as a covered helper (not inlined)
// so a future field rename on either side fails a unit test, not just e2e.
import type { ApiKeyPrincipal } from "./ports";
import type { UploadActor } from "./use-cases/upload-report";

export function principalToUploadActor(p: ApiKeyPrincipal): UploadActor {
  return { userId: p.userId, orgId: p.orgId, folderId: p.rootFolderId, scopes: p.scopes };
}

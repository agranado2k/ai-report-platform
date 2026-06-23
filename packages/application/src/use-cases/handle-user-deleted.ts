// handleUserDeleted — mirror a Clerk `user.deleted` event into our store (ADR-0054).
// Soft-deletes our `users` row and revokes all the user's API keys. Pure
// orchestration over the IdentityStore + ApiKeyStore ports (ADR-0024); the inbound
// webhook adapter verifies the signature and calls this. Idempotent: an unknown or
// already-deleted user is a successful no-op (webhooks retry / fan out).
import { type AppError, ok, type Result } from "arp-domain";
import type { ApiKeyStore, IdentityStore } from "../ports";

export interface HandleUserDeletedDeps {
  readonly identities: IdentityStore;
  readonly apiKeys: ApiKeyStore;
}

export interface HandleUserDeletedInput {
  /** The Clerk user id from the `user.deleted` event payload. */
  readonly clerkUserId: string;
}

export interface HandleUserDeletedResult {
  /** True when a user row matched (and is now soft-deleted); false for an unknown id. */
  readonly softDeleted: boolean;
  /** Number of API keys revoked by this run (0 on a replay where they're already revoked). */
  readonly keysRevoked: number;
}

export async function handleUserDeleted(
  deps: HandleUserDeletedDeps,
  input: HandleUserDeletedInput,
): Promise<Result<HandleUserDeletedResult, AppError>> {
  // softDeleteByClerkId resolves the user REGARDLESS of prior delete state, so this
  // self-heals: if a previous attempt soft-deleted but failed to revoke (→ 500 → Clerk
  // retry), the retry still runs the (idempotent) revoke. null = no such user.
  const soft = await deps.identities.softDeleteByClerkId(input.clerkUserId);
  if (!soft.ok) return soft;
  if (!soft.value) return ok({ softDeleted: false, keysRevoked: 0 });

  const revoked = await deps.apiKeys.revokeAllForUser(soft.value);
  if (!revoked.ok) return revoked; // 500 → Clerk retries → cascade re-runs next time
  return ok({ softDeleted: true, keysRevoked: revoked.value });
}

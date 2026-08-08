// createApiKey — mint a new ApiKey for the acting user in their acting org
// (ADR-0008 / ADR-0016). Pure orchestration over the ApiKeyStore port
// (ADR-0024): trims + validates the name (blank → 422 instead of minting an
// unnamed key), validates any scope selection against KEY_ISSUABLE_SCOPES
// (unknown/unenforced/empty → 422), defaults to the `reports:write` Scope
// when the caller doesn't pick. The secret is returned exactly once — the
// store never re-displays it (only the hashed/prefixed ApiKeySummary). The
// create + a `api_key.created` audit_log row (ADR-0070) commit together in
// one UnitOfWork (ADR-0037 section 5) -- the audit meta deliberately never
// carries the plaintext token.

import {
  type AppError,
  err,
  KEY_ISSUABLE_SCOPES,
  makeScopes,
  type OrgId,
  ok,
  REPORTS_WRITE_SCOPE,
  type Result,
  type Scope,
  type UserId,
  validationError,
} from "arp-domain";
import { commitWrite } from "../commit-write";
import { beginIdempotentWrite, type IdempotentWriteDeps, reviveReplay } from "../idempotent-write";
import type { ApiKeyStore, ApiKeySummary, AuditLogger, UnitOfWork } from "../ports";

/** The Scope a key is minted with when the caller doesn't pick (ADR-0016). */
const DEFAULT_SCOPES: readonly Scope[] = [REPORTS_WRITE_SCOPE];
const ROUTE = "POST /settings/api-keys";

export interface CreateApiKeyDeps extends IdempotentWriteDeps {
  readonly apiKeys: ApiKeyStore;
  /** Audit log (ADR-0070) -- one `api_key.created` row per mint. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export interface CreateApiKeyActor {
  readonly userId: UserId;
  readonly orgId: OrgId;
}
export interface CreateApiKeyInput {
  readonly name: string;
  readonly scopes?: readonly string[];
  /** The client's explicit `Idempotency-Key` (ADR-0039). For THIS use case the
   *  derived-fallback key is deliberately NOT applied (see below) — idempotency
   *  engages only when the caller supplies a key. */
  readonly idempotencyKey?: string;
}

/** The mint result. `token` is the one-time secret — present on a fresh mint,
 *  `null` on an idempotent REPLAY: the plaintext token is never persisted (we
 *  only store its HMAC, ADR-0008), so a replay can return the summary but can
 *  never re-display the secret. */
export interface CreatedApiKey {
  readonly token: string | null;
  readonly summary: ApiKeySummary;
}

export async function createApiKey(
  deps: CreateApiKeyDeps,
  actor: CreateApiKeyActor,
  input: CreateApiKeyInput,
): Promise<Result<CreatedApiKey, AppError>> {
  const name = input.name.trim();
  if (!name) return err(validationError("give your key a name", "name"));

  // Scope selection is validated against the ISSUABLE subset (ADR-0016) —
  // unknown / unenforced / empty selections are a 422, never persisted. The
  // default stays the lone `reports:write` when the caller doesn't pick.
  let scopes: readonly Scope[] = DEFAULT_SCOPES;
  if (input.scopes !== undefined) {
    const made = makeScopes(input.scopes, KEY_ISSUABLE_SCOPES);
    if (!made.ok) return made;
    scopes = made.value;
  }

  // Idempotency (ADR-0039), EXPLICIT-KEY ONLY — a deliberate narrowing: the
  // derived fallback would fingerprint on (name, scopes), silently replaying a
  // user's intentional second same-named key within 24h AND returning it
  // without a secret. Duplicate mints are cheap and harmless (keys are
  // revocable); a swallowed mint with no secret is not. The stored replay body
  // carries ONLY the summary — never the plaintext token.
  // The carve-out is centralized in beginIdempotentWrite via
  // `derivedFallback` — no local guard, so there is only ONE place this
  // decision can be made or drift (issue #233).
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: a swallowed duplicate mint returns no secret — worse than a cheap revocable duplicate
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [name, scopes.join(",")],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") {
    const summary = reviveReplay(
      idem.value.record,
      (body): body is ApiKeySummary =>
        typeof body === "object" &&
        body !== null &&
        typeof (body as Record<string, unknown>).id === "string" &&
        typeof (body as Record<string, unknown>).keyPrefix === "string",
    );
    if (!summary.ok) return summary;
    return ok({ token: null, summary: summary.value });
  }
  const idemRef = idem.value.ref;

  return commitWrite(
    deps,
    {
      idemRef,
      audit: (minted) => [
        {
          action: "api_key.created",
          orgId: actor.orgId,
          actorUserId: actor.userId,
          targetType: "api_key",
          targetId: minted.summary.id,
          // Deliberately no plaintext/secret in meta (ADR-0070).
          meta: {},
        },
      ],
      // summary ONLY — never the token
      response: (minted) => ({ responseStatus: 201, responseBody: minted.summary }),
    },
    async () =>
      deps.apiKeys.create({
        actingUserId: actor.userId,
        issuedInOrgId: actor.orgId,
        name,
        scopes,
      }),
  );
}

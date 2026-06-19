# ADR-0008: Hashed, prefixed, user-scoped API keys

- **Status**: Accepted
- **Date**: 2026-06-19
- **Deciders**: agranado2k
- **Supersedes / amends**: extracts ADR-008 from `docs/spec.html` (rev 9) into a standalone record, and **amends its hashing + prefix scheme** (see "Amendments" below). Builds on ADR-0048 (Clerk JIT personal-org provisioning), ADR-0020 (repository pattern), ADR-0024 (no I/O in domain), ADR-0016 (scopes).
- **Superseded by**: —

## Context and problem statement

`/api/v1` authenticates only via Clerk sessions today (`resolveUploadActor`/`resolveActorForRead`, ADR-0048). Programmatic callers — the forthcoming MCP server (ADR-003), scripts, autonomous agents — have no first-class credential: a Clerk session JWT is short-lived (~minutes) and needs the Clerk secret to mint, so it's unusable as a long-lived agent credential.

The `api_keys` table was modeled from day one (`packages/db/src/schema.ts`: `acting_user_id`, `issued_in_org_id`, `name`, `scopes`, `key_prefix`, `key_hash`, `last_used_at`, `revoked_at`) and the auth seam was written so "Clerk-session today and API keys later are interchangeable behind one port." This ADR is the implementation of that long-promised second credential.

## Decision drivers

- A **long-lived, revocable** credential an agent can hold in config.
- **Local, fast verification** on every `/api/v1` request — no network hop, no per-verify billing (this is why we use our own table, not Clerk's GA managed API-keys product; see the diary entry for the 2026-06-19 fork).
- Slot into the existing actor seam with **no route changes** (preserve the `UploadActor` contract).
- Keep crypto in the boundary layer (ADR-0020); the secret is never recoverable from our store.

## Considered options

- **Hashing**: argon2id (the spec's original) · plain SHA-256 · **HMAC-SHA-256 + server pepper** (chosen) — see "Amendments" for the rationale against argon2id.
- **Key store**: **our own `api_keys` table** (chosen — local, fast verification, no per-request network/billing) vs Clerk's GA managed API-keys product (a network verify + usage billing on every `/api/v1` request).
- **Prefix**: `rk_live_*` (the spec's literal) · `arp_` · **`arp_live_` / `arp_test_`** (chosen — project-branded + env-namespaced).
- **Downstream from the MCP**: the MCP relays the key to `/api/v1` (single-vendor pragmatic deviation) vs the MCP holding its own credential — settled in ADR-0051.

## Decision outcome

- **Token shape `arp_<env>_<secret>`** — `arp_live_…` (prod) / `arp_test_…` (previews/dev), 32 random bytes (256-bit) base64url. The first 12 chars are the non-secret, indexed `key_prefix`; the full secret is shown to the user **once** at creation and never persisted.
- **Hashing = HMAC-SHA-256 keyed by a server-side pepper** (`API_KEY_PEPPER`). Only the HMAC is stored in `key_hash`. Verification narrows by `key_prefix` (indexed), then does a **constant-time** (`timingSafeEqual`) compare per candidate. **Fail-closed**: with no pepper configured the `ApiKeyService` mints nothing and every verification returns `false`, so the `arp_` Bearer path is inert until the secret is provisioned (Clerk-session auth is unaffected). `API_KEY_PEPPER` is provisioned by Terraform per environment (live pepper for prod, a separate one for previews), so a preview key can never verify in prod.
- **Bound to `acting_user_id` + `issued_in_org_id`.** A verified key resolves the same `UploadActor` a session yields — the issuing user, their org, that org's Root folder (the Phase-1 write default), and the key's `scopes` (ADR-0016, read from the row, not hardcoded). `last_used_at` is stamped best-effort on each hit.
- **One-click revoke** by the owner (`revoked_at`); revoked keys never verify. Listing/minting/revoking lives behind the `ApiKeyStore` port (`DrizzleApiKeyRepository`), surfaced in the `settings.api-keys` management page.
- **Layering**: `ApiKeyService` (mint/HMAC/verify, `packages/adapters/src/services/api-key.ts`) → `DrizzleApiKeyRepository` (`ApiKeyStore` port) → `authenticateApiKey` use case (maps principal → `UploadActor`) → the seam tries a Bearer `arp_…` first, else falls back to Clerk.

## Amendments to spec.html ADR-008

The spec proposed `rk_live_*` keys, **argon2id**-hashed. Both are amended here with rationale:

1. **HMAC-SHA-256 + pepper, NOT argon2id.** API keys are 256-bit *random* secrets, so an offline preimage/brute-force of the hash is infeasible regardless of hash speed — argon2id's slow-hashing (which exists to defend *low-entropy human passwords*) buys nothing here, while running it on every `/api/v1` request would add ~50–100 ms latency and defeat the "fast local verification" rationale for owning the table. HMAC with a server pepper is fast **and** means a DB-only leak can't even verify guesses. (Argon2id would only matter if keys were low-entropy, which they are not.)
2. **`arp_live_`/`arp_test_` prefix**, not `rk_live_*` — project-branded (matches the `arp-*` packages) while keeping the spec's live/test environment namespacing.

## Consequences

- **Good**: usable agent credential; fast hot-path auth; defense-in-depth (pepper); no route churn; matches the OpenAPI `apiKey` bearer scheme already declared on every `/api/v1` op.
- **Trade-offs**: a new server secret to provision + rotate (`API_KEY_PEPPER`); rotating the pepper invalidates all existing keys (acceptable — keys are re-mintable; document in the ops runbook). Anomaly detection (ADR-0016) is deferred.

## More information

- Spec source: `docs/spec.html` ADR-008 (rev 9). The OpenAPI bearer `apiKey` scheme (`docs/api/openapi.yaml`) already declares this on every `/api/v1` op.
- Implementation: `packages/adapters/src/services/api-key.ts` (mint/HMAC/verify), `packages/adapters/src/api-key-repository.ts` (the `ApiKeyStore` adapter), the port in `packages/application/src/ports.ts`, `authenticateApiKey` in `packages/application/src/use-cases/`, and the seam `apps/app/app/server/auth.server.ts`.
- The Clerk-managed-keys vs own-table fork is logged in `docs/diary.md` (2026-06-19). Scope vocabulary + enforcement: ADR-0016. MCP consumption: ADR-0051.

# ADR-0054: User soft-delete via the Clerk `user.deleted` webhook (terminal, with API-key revoke cascade)

- **Status**: Accepted
- **Date**: 2026-06-23
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0048 (auth provisioning — *deferred* webhooks; this un-defers them for `user.deleted`), ADR-0008/ADR-0016 (API keys), ADR-005 (shared user pool), ADR-0036 (Identity & Access context).

## Context and problem statement

`reports` and `folders` carry `deleted_at` (soft-delete), but `users` did not — there was no way to honour an account deletion, and ADR-0048 chose JIT provisioning with **no webhooks**, so a deletion in Clerk left our mirror stale indefinitely. We need to (a) react to a user being deleted in Clerk and (b) do so without orphaning data or leaving credentials live.

## Decision drivers

- Mirror Clerk as the identity source of truth (we don't own the Clerk lifecycle).
- Reversible, audit-friendly deletion (we keep `report_versions.uploaded_by_user` history; FKs are `ON DELETE RESTRICT`).
- No live credentials for a deleted user.

## Considered options

- **Clerk `user.deleted` webhook → soft-delete + cascade** *(chosen)*.
- **Hard delete** — rejected: every user FK is `ON DELETE RESTRICT` (versions, audit, idempotency, collaborators), it destroys audit/version history, and it's irreversible.
- **Self-serve "delete my account" endpoint** — deferred: the webhook mirrors Clerk (where deletion actually happens); a self-serve action can call the same use case later.
- **Cascade the personal org + its reports** — rejected for now: reports are org-owned and stay functional; cascading the workspace is a heavier, separate decision.

## Decision outcome

1. **Trigger** — a Clerk `user.deleted` **webhook** (`POST /webhooks/clerk`), verified with `@clerk/backend`'s `verifyWebhook` against `CLERK_WEBHOOK_SIGNING_SECRET` (Standard Webhooks / Svix scheme). **No new dependency.** This *un-defers* the ADR-0048 webhook decision, scoped to `user.deleted` for now. The route **fails closed**: no secret → `503` (inert), bad signature → `400`.
2. **Soft-delete** — stamp `users.deleted_at` (mirrors `reports`/`folders`); a partial `WHERE deleted_at IS NOT NULL` index serves the purge job.
3. **Read-filtering** — `IdentityStore.findByClerk` excludes soft-deleted users → a deleted user resolves to **no actor** (the session path 401s; the API-key path fails because its keys are revoked).
4. **Terminal** — `createPersonalIdentity` **refuses to resurrect** a soft-deleted user; a re-auth with the same Clerk identity stays blocked. Restoring is an explicit, out-of-band action (future).
5. **Cascade** — revoke **all** the user's API keys (`ApiKeyStore.revokeAllForUser`). The org + its reports stay live (org-owned — a user soft-delete does not orphan reports).
6. **Idempotent** — replays / unknown ids are no-ops (`softDeleteByClerkId` returns null → no cascade), so Clerk's at-least-once retries are safe.

## Consequences

- **Good**: honours deletions, kills credentials, keeps data + audit history, reversible in principle, zero new deps.
- **Trade-offs / follow-ups**:
  - **First inbound webhook endpoint** — requires `CLERK_WEBHOOK_SIGNING_SECRET` (env) **and** registering the endpoint in Clerk (subscribed to `user.deleted`). Until both are configured the route is inert (`503`) — the code can ship ahead of the infra.
  - **No restore path yet** — un-deleting is manual (clear `deleted_at`); a restore flow is deferred.
  - **Orphaned personal org** — a deleted user's personal org + reports remain; workspace cleanup is a separate decision.
  - The auth seam treats `findByClerk → null` as "provision a new identity"; the resurrection block in `createPersonalIdentity` is what stops a deleted user being silently re-created.

## More information

- Implemented in `packages/application` (`handleUserDeleted` use case, `IdentityStore.softDeleteByClerkId`, `ApiKeyStore.revokeAllForUser`), `packages/adapters` (Drizzle impls + pglite integration tests), `packages/db` (migration `0006`), and `apps/app` (`webhooks.clerk` route, `userWebhookDeps`, the `CLERK_WEBHOOK_SIGNING_SECRET` env).
- Infra (separate, operator-applied): set `CLERK_WEBHOOK_SIGNING_SECRET` in Vercel env and register the Clerk webhook endpoint.

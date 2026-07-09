# ADR-0070: Audit log write seam — the `AuditLogger` port, mirroring the transactional outbox

- **Status**: Accepted
- **Date**: 2026-07-09
- **Deciders**: agranado2k
- **Relates to / amends**: mirrors ADR-0021's transactional-outbox shape and ADR-0037 §5's commit-last atomicity for the new `audit_log` table (`packages/db/src/schema.ts`). Does not change either.

## Context and problem statement

The `audit_log` table has existed in the schema since Phase 1 (`packages/db/src/schema.ts`), and the docs describe the product's behavior as "every mutating action writes a row" — but no use case actually writes to it (issue #153). The table is dead weight: present in migrations, absent from the write path. Any promise of an audit trail (for the eventual abuse/moderation and compliance surfaces) is currently false.

The fix needs a driven port, a real (Drizzle) adapter, and an in-memory test double — the exact three-part shape every other driven port in `packages/application/src/ports.ts` already has (`EventOutbox`, `IdempotencyStore`, `ReportRepository`, …). `EventOutbox` (ADR-0021) is the closest analog: it also appends rows that must land in the SAME transaction as the state change it accompanies. This ADR establishes the seam and wires all sixteen user-initiated, org-scoped mutating use cases against it: `uploadReport`/`deleteReport` first as the pattern proof, then the remaining report/folder use cases, then ACL/grant/comment/API-key use cases, each a mechanical repeat of §5 against the same template.

## Decision drivers

- Match the existing outbox seam's shape exactly (port → Drizzle adapter → in-memory double → harness handle) so the pattern is instantly recognizable and mechanically repeatable across the remaining use cases.
- Commit-last atomicity (ADR-0037 §5): an audit row must never be visible for a mutation that didn't actually commit, and a mutation must never commit silently un-audited.
- Stay inside the application layer's existing constraints: `Result`/no-throw, `readonly` types, no I/O in domain code, no new dependencies (ADR-024).
- Keep the scope of what gets audited deliberately narrow at first — user-initiated actions, not every system event — so the seam ships small and reviewable rather than as one sprawling PR touching every use case at once.

## Decision outcome

### 1. The `AuditLogger` port (mirrors `EventOutbox`)

`packages/application/src/ports.ts`, immediately after `EventOutbox`:

```ts
export interface AuditLogger {
  /** Append audit rows in the same transaction as the state change (ADR-0070). */
  record(entries: readonly AuditEntry[]): Promise<Result<void, AppError>>;
}
```

`AuditEntry` + the closed `AuditAction` vocabulary live in a new `packages/application/src/audit.ts`, exported from the package root. `AuditEntry.actorUserId` is nullable to match the schema's FK (`ON DELETE RESTRICT` but nullable), and `meta` is an optional freeform `Record<string, unknown>` for action-specific detail (e.g. `{ versionId }` on an upload).

### 2. `DrizzleAuditLogger` — a structural copy of `DrizzleEventOutbox`

`packages/adapters/src/audit-logger.ts`: same constructor shape (`private readonly ctx: DbContext`), same empty-list guard (`entries.length === 0 → ok(undefined)`), same try/catch → `{ kind: "Unexpected", message: "audit.record: …" }` mapping, same `uuidv7()`-generated `id`. The one adapter-specific decision: `at` is left unset so the DB's `defaultNow()` stamps it (matching how `outbox.availableAt`/`createdAt` are handled) rather than the application layer supplying a clock.

### 3. `ipHash` / `geo` are always written `null` from this layer

The `audit_log` schema carries `ip_hash` and `geo` columns for future abuse-signal correlation, but the application layer is deliberately request-free (ADR-024) — it never sees the HTTP request. `DrizzleAuditLogger` always writes `null` for both. Populating them is a follow-up: an HTTP-layer decorator (or a param threaded down from the composition root) that hashes the caller's IP and resolves geo before calling `audit.record`. Out of scope here.

### 4. Scope: user-initiated, org-scoped mutations only

`AuditAction` covers report/folder/acl/grant/comment/api-key mutations initiated by a signed-in actor — the set with a real `orgId` + `actorUserId` at the call site. System- or webhook-driven use cases (`processScanResult`, `handleUserDeleted`, `provisionIdentity`) are explicitly **excluded** from this seam: they already emit `DomainEvent`s through the outbox, which is the correct trail for automated/system state transitions, and forcing them onto `AuditLogger` would mean synthesizing an `orgId`/`actorUserId` that doesn't cleanly exist for a webhook. If a compliance need for "who/what changed this and why" emerges for those flows later, it should be evaluated against the existing event stream first, not bolted onto the same seam.

The sixteen wired actions, grouped by resource:

| Resource | Actions |
| --- | --- |
| report | `report.uploaded`, `report.renamed`, `report.moved`, `report.deleted` |
| folder | `folder.created`, `folder.renamed`, `folder.deleted` |
| acl | `acl.set` |
| grant | `grant.write.granted`, `grant.write.revoked` |
| comment | `comment.added`, `comment.replied`, `comment.resolved`, `comment.deleted` |
| api_key | `api_key.created`, `api_key.revoked` |

Two actor-shape gaps surfaced while wiring the pattern beyond the first two use cases — both closed in this same PR, not deferred:
- Folder actors (`createFolder`, `renameFolder`, `deleteFolder`) carried only `orgId`, not `userId`. They're now aliased to the shared `TenancyActor { orgId, userId }` so `folder.*` audit rows carry a real `actorUserId`. Authorization still keys ONLY on `orgId` via `loadOwnedFolder` — `userId` is carried solely for audit attribution, never for authz.
- `revokeApiKey`'s actor didn't carry `orgId` (`audit_log.org_id` is `NOT NULL`). Its actor type gained `orgId`; the one call site (`settings.api-keys.tsx`) now threads it from the resolved actor.
- One remaining nuance, not a gap: `revokeWrite` has no `IdentityStore` dependency and `WriteGrantStore.revoke()` doesn't return the grant row, so there's no resolved `UserId` for the grantee at that call site. Its `grant.write.revoked` row's `meta` carries `{ granteeEmail }` instead — the actual revoke key and the only grantee-identifying value on hand — unlike `grantWrite`'s `meta`, which can carry a resolved `granteeUserId` when one exists.

### 5. Commit-last atomicity: audit write is the last (or co-equal-last) step inside `uow.run`

All sixteen wired use cases put `audit.record(...)` inside the existing/added `deps.uow.run(...)` callback, after the domain mutation. Load + authorization always stays OUTSIDE the transaction (unchanged); only the mutation and the audit row are wrapped together:

- **`uploadReport`** (`packages/application/src/use-cases/upload-report.ts`): the audit call is added as a new step inside the *existing* commit block (`reports.save` → `outbox.enqueue` → **`audit.record`** → `idempotency.complete`), so a fresh upload's `report.uploaded` row commits or rolls back with the report row and its outbox event in one Postgres transaction. A **replayed** idempotent retry never re-enters this block — exactly one audit row per real mutation, proven by a dedicated test.
- **`deleteReport`** (`packages/application/src/use-cases/delete-report.ts`): previously a bare `deps.reports.softDelete(...)` call with **no** `UnitOfWork` at all. This ADR adds one: `deps.uow.run(async () => { softDelete → audit.record })`. This is the first transactional wrapping delete-report has ever had — a deliberate, in-scope fix, since without it the audit write couldn't be atomic with the delete by construction.
- **`renameReport` / `moveReport`**: same shape as `deleteReport`; each writes `report.renamed` / `report.moved` with a from/to `meta` diff (title, folder).
- **`createFolder` / `renameFolder` / `deleteFolder`**: `folder.created` / `folder.renamed` / `folder.deleted`, gated by `loadOwnedFolder` outside the transaction as before.
- **`setAcl`**: previously issued **two** separate unwrapped writes (grant pruning + the `Acl` persist) — now both, plus `acl.set`, land in one `uow.run`, closing a second latent atomicity gap alongside `deleteReport`'s.
- **`grantWrite` / `revokeWrite`**: `grant.write.granted` / `grant.write.revoked`; `grantWrite`'s `meta` carries the opportunistically-resolved `granteeUserId` (may be null pre-signup), `revokeWrite`'s carries `granteeEmail` (see §4).
- **`addComment` / `replyToComment` / `resolveComment`**: already had a `uow.run` spanning the repo save + outbox enqueue (ADR-0064 §6); the audit record joins that same transaction. `deleteComment` gains a `UnitOfWork` wrapper where none existed (no domain event on delete, so audit is its only transactional companion).
- **`createApiKey` / `revokeApiKey`**: gain a `UnitOfWork` wrapper where none existed. `createApiKey`'s audit `meta` deliberately omits the plaintext token/secret — only the summary fields land in `audit_log`.

### 6. Proof of atomicity: a real-Postgres integration test, not just an in-memory unit test

The in-memory `PassThroughUnitOfWork` fake used by the existing use-case unit tests calls `work()` directly with no transaction and no rollback — `InMemoryReportRepository.softDelete` mutates its map unconditionally, so an in-memory test cannot actually prove "the mutation rolled back." The real proof is `packages/adapters/src/delete-report.integration.test.ts`: it wires `deleteReport` with the **real** `DrizzleReportRepository` + `DrizzleUnitOfWork` + a stub `AuditLogger` that always fails, against pglite, and asserts the report row's `deleted_at` stays `null` and no `audit_log` row exists — mirroring the existing rollback proof pattern in `unit-of-work.integration.test.ts`. The use-case-level unit test (`delete-report.test.ts`) still asserts the use case *returns* the audit error; it documents, in a comment, why it can't independently prove the persistence-didn't-happen half. The remaining fourteen use cases rely on this one real-Postgres proof plus their own use-case-level unit test asserting the returned audit error — the rollback mechanics themselves are `DrizzleUnitOfWork`'s (already proven), not re-proven per call site.

## Considered options

- **Event-subscriber fan-out** (an outbox consumer that projects `DomainEvent`s into `audit_log` rows asynchronously) — rejected. It decouples the audit write from the mutation's transaction, so a failed relay (or a relay that hasn't run yet) leaves a window where a real mutation has zero audit trail — unacceptable for an audit log's core promise. It would also require every use case's events to carry enough actor/target detail to reconstruct an `AuditEntry`, which several currently don't.
- **Trimming/relaxing the docs' "every mutating action writes a row" claim instead of building the seam** — rejected. The table and the claim predate this ADR; the fix is to make the claim true, not to walk it back, especially with issue #153 open specifically because the claim is currently false.
- **A single combined `EventOutbox`-and-`AuditLogger` port** (one `enqueue` call that writes both an event and an audit row) — rejected. Events and audit rows have different consumers (an async relay worker vs. a query-side compliance/abuse view), different vocabularies (`DomainEvent`'s `type` vs. `AuditAction`), and not every event maps 1:1 to a user-initiated audited action (e.g. system events). Keeping them as two ports composed inside the same `uow.run` block preserves that distinction while still getting atomicity.

## Consequences

- **Good**: the seam is minimal, structurally identical to a port every contributor already knows (`EventOutbox`), and provable with the same real-Postgres integration-test pattern already established for the outbox and the unit-of-work rollback.
- **Good**: `deleteReport`, `setAcl`, `grantWrite`, `deleteComment`, `createApiKey`, and `revokeApiKey` each gain their first-ever transactional wrapper as a side effect — closes several latent gaps (a mutation that half-completes on a downstream failure) that predate this ADR, `setAcl`'s two-separate-unwrapped-writes case being the largest.
- **Good**: all sixteen user-initiated, org-scoped mutations now write an audit row — the docs' "every mutating action writes a row" claim (`docs/db-design.md`) is true for the scope this ADR defines (see §4 for what's deliberately excluded).
- **Trade-offs**: `ipHash`/`geo` are always `null` for now — every audit row this ADR's use cases write is strictly less rich than the schema allows for, until the HTTP-layer follow-up lands. `revokeWrite`'s `grant.write.revoked` rows carry `granteeEmail` instead of a resolved `actorUserId`-shaped grantee reference, for the structural reason in §4 (not expected to change without adding an `IdentityStore` dependency there).

## More information

- `docs/adr/0021-transactional-outbox.md` is folded into `docs/spec.html`'s ADR-001–030 backlog (not yet extracted); the outbox shape it (and its Drizzle adapter, `packages/adapters/src/event-outbox.ts`) established is what this ADR mirrors.
- `packages/application/src/ports.ts` — the `AuditLogger` port, next to `EventOutbox`.
- `packages/application/src/audit.ts` — `AuditAction` + `AuditEntry`.
- `packages/adapters/src/audit-logger.ts` — `DrizzleAuditLogger`.
- `packages/adapters/src/delete-report.integration.test.ts` — the real-Postgres atomicity/rollback proof.
- Issue #153.

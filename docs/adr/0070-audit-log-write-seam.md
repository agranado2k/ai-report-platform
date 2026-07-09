# ADR-0070: Audit log write seam — the `AuditLogger` port, mirroring the transactional outbox

- **Status**: Accepted
- **Date**: 2026-07-09
- **Deciders**: agranado2k
- **Relates to / amends**: mirrors ADR-0021's transactional-outbox shape and ADR-0037 §5's commit-last atomicity for the new `audit_log` table (`packages/db/src/schema.ts`). Does not change either.

## Context and problem statement

The `audit_log` table has existed in the schema since Phase 1 (`packages/db/src/schema.ts`), and the docs describe the product's behavior as "every mutating action writes a row" — but no use case actually writes to it (issue #153). The table is dead weight: present in migrations, absent from the write path. Any promise of an audit trail (for the eventual abuse/moderation and compliance surfaces) is currently false.

The fix needs a driven port, a real (Drizzle) adapter, and an in-memory test double — the exact three-part shape every other driven port in `packages/application/src/ports.ts` already has (`EventOutbox`, `IdempotencyStore`, `ReportRepository`, …). `EventOutbox` (ADR-0021) is the closest analog: it also appends rows that must land in the SAME transaction as the state change it accompanies. This ADR establishes the seam once, wires two representative use cases (`uploadReport`, `deleteReport`) as the pattern proof, and leaves the remaining ~14 mutating use cases to be wired mechanically in follow-up PRs against this template.

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

Two known scope gaps, deliberately deferred to the use cases that wire them:
- Folder actors (`createFolder`, `renameFolder`, `deleteFolder`) currently carry only `orgId`, not `userId` — a later slice must widen their actor type before `folder.*` audit rows can carry a real `actorUserId`.
- `revokeApiKey`'s actor doesn't currently carry `orgId` — same gap, same deferral, for `api_key.revoked`.

### 5. Commit-last atomicity: audit write is the last (or co-equal-last) step inside `uow.run`

Both wired use cases put `audit.record(...)` inside the existing/added `deps.uow.run(...)` callback, after the domain mutation:

- **`uploadReport`** (`packages/application/src/use-cases/upload-report.ts`): the audit call is added as a new step inside the *existing* commit block (`reports.save` → `outbox.enqueue` → **`audit.record`** → `idempotency.complete`), so a fresh upload's `report.uploaded` row commits or rolls back with the report row and its outbox event in one Postgres transaction. A **replayed** idempotent retry never re-enters this block — exactly one audit row per real mutation, proven by a dedicated test.
- **`deleteReport`** (`packages/application/src/use-cases/delete-report.ts`): previously a bare `deps.reports.softDelete(...)` call with **no** `UnitOfWork` at all. This ADR adds one: `deps.uow.run(async () => { softDelete → audit.record })`. This is the first transactional wrapping delete-report has ever had — a deliberate, in-scope fix, since without it the audit write couldn't be atomic with the delete by construction.

### 6. Proof of atomicity: a real-Postgres integration test, not just an in-memory unit test

The in-memory `PassThroughUnitOfWork` fake used by the existing use-case unit tests calls `work()` directly with no transaction and no rollback — `InMemoryReportRepository.softDelete` mutates its map unconditionally, so an in-memory test cannot actually prove "the mutation rolled back." The real proof is `packages/adapters/src/delete-report.integration.test.ts`: it wires `deleteReport` with the **real** `DrizzleReportRepository` + `DrizzleUnitOfWork` + a stub `AuditLogger` that always fails, against pglite, and asserts the report row's `deleted_at` stays `null` and no `audit_log` row exists — mirroring the existing rollback proof pattern in `unit-of-work.integration.test.ts`. The use-case-level unit test (`delete-report.test.ts`) still asserts the use case *returns* the audit error; it documents, in a comment, why it can't independently prove the persistence-didn't-happen half.

## Considered options

- **Event-subscriber fan-out** (an outbox consumer that projects `DomainEvent`s into `audit_log` rows asynchronously) — rejected. It decouples the audit write from the mutation's transaction, so a failed relay (or a relay that hasn't run yet) leaves a window where a real mutation has zero audit trail — unacceptable for an audit log's core promise. It would also require every use case's events to carry enough actor/target detail to reconstruct an `AuditEntry`, which several currently don't.
- **Trimming/relaxing the docs' "every mutating action writes a row" claim instead of building the seam** — rejected. The table and the claim predate this ADR; the fix is to make the claim true, not to walk it back, especially with issue #153 open specifically because the claim is currently false.
- **A single combined `EventOutbox`-and-`AuditLogger` port** (one `enqueue` call that writes both an event and an audit row) — rejected. Events and audit rows have different consumers (an async relay worker vs. a query-side compliance/abuse view), different vocabularies (`DomainEvent`'s `type` vs. `AuditAction`), and not every event maps 1:1 to a user-initiated audited action (e.g. system events). Keeping them as two ports composed inside the same `uow.run` block preserves that distinction while still getting atomicity.

## Consequences

- **Good**: the seam is minimal, structurally identical to a port every contributor already knows (`EventOutbox`), and provable with the same real-Postgres integration-test pattern already established for the outbox and the unit-of-work rollback.
- **Good**: `deleteReport` gains its first-ever transactional wrapper as a side effect — closes a latent gap (a delete that half-completes on a downstream failure) that predates this ADR.
- **Trade-offs**: `ipHash`/`geo` are always `null` for now — the audit rows this PR's two use cases write are strictly less rich than the schema allows for, until the HTTP-layer follow-up lands. Folder and API-key actions cannot record a real `actorUserId`/`orgId` respectively until their actor types widen.
- **Neutral**: the remaining ~14 mutating use cases are intentionally left unwired here — this ADR's job is to prove the pattern, not deliver full coverage. Each follow-up wiring is a mechanical repeat of §5, reviewed against this ADR.

## More information

- `docs/adr/0021-transactional-outbox.md` is folded into `docs/spec.html`'s ADR-001–030 backlog (not yet extracted); the outbox shape it (and its Drizzle adapter, `packages/adapters/src/event-outbox.ts`) established is what this ADR mirrors.
- `packages/application/src/ports.ts` — the `AuditLogger` port, next to `EventOutbox`.
- `packages/application/src/audit.ts` — `AuditAction` + `AuditEntry`.
- `packages/adapters/src/audit-logger.ts` — `DrizzleAuditLogger`.
- `packages/adapters/src/delete-report.integration.test.ts` — the real-Postgres atomicity/rollback proof.
- Issue #153.

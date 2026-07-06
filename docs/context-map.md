# Context map

Per **ADR-0036** (Domain-Driven Design). The three bounded contexts and how they integrate. Term spellings follow `docs/domain-glossary.md`; event names follow `docs/events.md`.

```
                    ┌─────────────────────────────┐
                    │       Identity & Access      │
                    │  users · orgs · api-keys ·   │
                    │  plans · anomaly detection   │
                    └──────┬────────────────┬──────┘
       shared kernel +     │                │   shared kernel
       UserCreated event   ▼                ▼   (UserId, OrgId)
   ┌──────────────────────────┐   ┌──────────────────────────┐
   │     Reports & Folders     │   │     Abuse & Moderation    │
   │  reports · versions ·     │   │  scan-jobs · abuse-       │
   │  folders · acls ·         │   │  reports · takedowns ·    │
   │  write-grants             │   │  csp-reports              │
   └──────────────────────────┘   └──────────────────────────┘
        ReportVersionUploaded ───────────▶  enqueue ScanJob
        ReportVersionScanned  ◀───────────  verdict → scan_status
        ReportTakenDown       ◀───────────  → Report.deleted_at
```

## Bounded contexts

### Identity & Access

**Owns**: `users`, `orgs` (with `Plan` / `PlanLimits`), `api_keys`, and API-key anomaly detection.

**Exposes (as shared kernel)**: `UserId`, `OrgId` branded types. Both originate in Clerk and are mirrored locally.

**Consumes**: Clerk webhooks (user / org lifecycle) via an anti-corruption layer.

**Aggregates**:
- `Org` (root) — tenancy unit; carries `Plan` + `PlanLimits`.
- `ApiKey` (root) — user-scoped credential with its `Scope`s.

**Domain service**: `AnomalyDetector` — evaluates `ApiKeyUsed` against historical baselines; the `Anomaly` read-model surfaces flagged usage.

**Emits events**: `UserCreated`, `ApiKeyUsed` (from the API auth middleware), `ApiKeyAnomalyDetected`.

### Reports & Folders

**Owns**: `folders`, `reports`, `report_versions`, `acls`, `report_grants`, `report_write_grants` (and the superseded, unused `folder_collaborators` — ADR-0060 — pending a cleanup migration).

**Aggregates**:
- `Folder` (root) — the folder tree. Org-scoped (no per-user owner, ADR-0059); the superseded `Collaborator` grant chain (ADR-009/0056 P4) never became behavioral code.
- `Report` (root) — its `ReportVersion`s, its single `Acl`, its **`Owner`** (`owner_id`, the creating user — ADR-0059), its `Write grant`s (ADR-0060), its `live_version_id`, and the `scan_status` Value Object cached on each `ReportVersion`.

**Permission resolution** (ADR-0059/0060): report writes compose as `canWrite(report, user) = IsOwner(report, user) OR HasWriteGrant(report, user)` — an Application-layer check on the `Report` aggregate; `delete`/`set_acl`/grant management are owner-only. Folder operations stay `IsOrgMember(folder.orgId)`. Org membership alone confers list-metadata visibility, never content or write access.

**Consumes**: `UserCreated` from Identity & Access — optional optimization only (ADR-0060): backfill a pending `Write grant`'s `grantee_user_id`; grants are matched by normalized email at check time, so nothing blocks on the event.

**Emits events**: `ReportVersionUploaded`, `ReportPublished` (fires whenever `live_version_id` moves — first publish or re-point; the welcome notifier checks whether it is the first), `AclChanged`, `CollaboratorGranted` (superseded by ADR-0060 — to be replaced by a write-grant event in `docs/events.md` when grants land). Consumed by Abuse & Moderation and by side effects (audit log, notifications, cache invalidation) in the Application layer.

### Abuse & Moderation

**Owns**: `scan_jobs` (the `ScanJob` aggregate and its `findings`), `abuse_reports`, `csp_reports`, takedown audit rows.

**Aggregates**:
- `ScanJob` (root) — one per `ReportVersion`; lifecycle `queued` → `running` → `done`/`failed`. Runs ClamAV + heuristics, holds the `findings`, and on completion emits `ReportVersionScanned` with the verdict.
- `AbuseReport` (root) — reporter info (IP hashed), reasons, triage `status`, action audit trail.

**Depends on**: shared kernel; reads `Report.slug` to attach abuse reports.

**Emits events**: `ReportVersionScanned`, `AbuseReported`, `ReportTakenDown`, `CspViolationReported`. `ReportVersionScanned` is consumed by Reports & Folders to set `ReportVersion.scan_status` (and auto-publish when `clean`). `ReportTakenDown` is consumed by Reports & Folders, which sets `Report.deleted_at` and queues R2 purges.

## Integration patterns

- **Shared kernel** is limited to identity primitives (`UserId`, `OrgId`). No business types are shared across contexts — those are owned by exactly one context and copied to the others as needed.
- **Domain events** flow through the transactional outbox in Postgres (per the spec's event-driven decision). Events are the only cross-context call path for write paths. The full catalog is `docs/events.md`.
- **Read paths** can join across context boundaries inside an adapter (e.g., a dashboard view joining `reports` + `users` for "uploaded by"). The *write* path is what aggregate boundaries protect; read paths are allowed pragmatic joins.
- **Anti-corruption layer** — Clerk's webhook payloads land in an adapter that translates Clerk's shape into our `User` / `Org` types before the domain sees them. Same pattern for any future external integration (Stripe, etc.).

## What does NOT go through the context map

- The viewer pipeline (`view.<domain>`) reads from `Reports & Folders` directly via the application's read repositories. It does not emit domain events.
- API key authentication is a cross-cutting concern handled in the edge / middleware layer before any context-owned code runs. The middleware emits `ApiKeyUsed` (consumed by the `AnomalyDetector`), but auth itself is not a context-owned write path.

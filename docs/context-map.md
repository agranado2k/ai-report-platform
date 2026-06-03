# Context map

Per **ADR-0036** (Domain-Driven Design). The three bounded contexts and how they integrate.

```
                ┌────────────────────────────┐
                │   Identity & Access        │
                │   (users, orgs, api-keys,  │
                │    collaborators)          │
                └────────────────────────────┘
                       ▲                ▲
                       │                │
                  shared kernel     shared kernel
                  (UserId, OrgId)   (UserId, OrgId)
                       │                │
                       ▼                ▼
   ┌──────────────────────────┐   ┌──────────────────────────┐
   │   Reports & Folders      │──▶│   Abuse & Moderation     │
   │   (reports, versions,    │   │   (scan-status, abuse-   │
   │    folders, acls)        │   │    reports, takedowns,   │
   │                          │   │    csp-reports)          │
   └──────────────────────────┘   └──────────────────────────┘
              ▲                              │
              │                              │
              └──── domain events ───────────┘
                    (TakedownActioned →
                     mark Report.deleted_at)
```

## Bounded contexts

### Identity & Access

**Owns**: `users`, `orgs`, `api_keys`, `folder_collaborators`.

**Exposes (as shared kernel)**: `UserId`, `OrgId` branded types. Both originate in Clerk and are mirrored locally.

**Consumes**: Clerk webhooks (user / org lifecycle).

### Reports & Folders

**Owns**: `folders`, `reports`, `report_versions`, `acls`.

**Aggregates**:
- `Folder` (root) — folders, plus the inherited grant chain that decides write permission.
- `Report` (root) — its versions, its single ACL row, its `live_version_id`.

**Depends on**: shared kernel from Identity & Access (`UserId`, `OrgId`). Permission checks call into `canWrite(user, folder)` defined in the Application layer, which walks the folder tree using `Folder` data plus `folder_collaborators` from Identity & Access.

**Emits events**: `ReportPublished`, `VersionUploaded`, `LiveVersionChanged`, `AclChanged`. Consumed by Abuse & Moderation and by side effects (audit log, notifications) in the Application layer.

### Abuse & Moderation

**Owns**: `report_versions.scan_status`, `report_versions.scan_findings`, `abuse_reports`, `csp_reports`, takedown audit rows.

**Aggregates**:
- `ScanResult` (per `Version`) — finalized when ClamAV + heuristics complete. Drives the `Version`'s public-serving status.
- `AbuseReport` (root) — reporter info (hashed), reasons, triage status, action audit trail.

**Depends on**: shared kernel; reads `Report.slug` to attach abuse reports.

**Emits events**: `VersionScanned`, `AbuseReportFiled`, `TakedownActioned`. `TakedownActioned` is consumed by Reports & Folders, which sets `Report.deleted_at` and queues R2 purges.

## Integration patterns

- **Shared kernel** is limited to identity primitives (`UserId`, `OrgId`). No business types are shared across contexts — those are owned by exactly one context and copied to the others as needed.
- **Domain events** flow through the transactional outbox in Postgres (per the spec's event-driven decision). Events are the only cross-context call path for write paths.
- **Read paths** can join across context boundaries inside an adapter (e.g., a dashboard view joining `reports` + `users` for "uploaded by"). The *write* path is what aggregate boundaries protect; read paths are allowed pragmatic joins.
- **Anti-corruption layer** — Clerk's webhook payloads land in an adapter that translates Clerk's shape into our `User` / `Org` types before the domain sees them. Same pattern for any future external integration (Stripe, etc.).

## What does NOT go through the context map

- The viewer pipeline (`view.<domain>`) reads from `Reports & Folders` directly via the application's read repositories. It does not emit domain events.
- API key authentication is a cross-cutting concern handled in the edge / middleware layer before any context-owned code runs.

# Domain events

The canonical registry of domain events, per **ADR-0036** (Domain-Driven Design) and the spec's event-driven architecture. Term spellings follow `docs/domain-glossary.md`; the integration map is `docs/context-map.md`.

**Design rules** (from the spec):

- **Events are facts**, named in past tense (`ReportPublished`, not `PublishReport`).
- **Version-scoped events use the `ReportVersion` prefix** (`ReportVersionUploaded`, `ReportVersionScanned`) because re-uploading creates a new `ReportVersion`, never a new `Report`.
- **Payloads carry just enough** for handlers to act — usually the aggregate id and the new state. Handlers re-fetch if they need more.
- **Idempotent handlers** — every handler tolerates being invoked twice (delivery is at-least-once).
- **One commit, one event** — don't emit two ordered events from one transaction; emit one and let handlers fan out.
- **No event-driven cycles** — a handler may produce a new event but not one already on the call chain (CI static check).
- **Transport** — the Postgres transactional outbox, drained by the dispatcher worker (~1s poll). Ordered per aggregate.

---

## Catalog

| Event | Emitter (context) | Subscribers | Notes |
|---|---|---|---|
| `ReportVersionUploaded` | Reports & Folders (`UploadReportUseCase`) | enqueue `ScanJob` (Abuse & Moderation) · AuditLogger | Every upload — first upload and every re-upload. |
| `ReportPublished` | Reports & Folders (`PromoteVersionUseCase`) | CacheInvalidator (edge KV / CDN) · Notifier (welcome, **only if first publish**) · AuditLogger | Fires whenever `live_version_id` moves. Subsumes the old `LiveVersionChanged`. |
| `AclChanged` | Reports & Folders (`UpdateAclUseCase`) | CacheInvalidator (viewer gate changed) | Sharing mode / password / allowlist change. |
| `CollaboratorGranted` | Reports & Folders (`GrantFolderAccessUseCase`) | Notifier (email + magic link) · AuditLogger | **Superseded by ADR-0060** (folder collaborators never built) — to be replaced by a per-report write-grant event when grants land; this row and `scripts/docs-conformance/config.mjs` update together in that PR. |
| `UserCreated` | Identity & Access (Clerk webhook ACL) | Reports & Folders (resolve pending `Collaborator` `grantee_email` → `UserId`) · AuditLogger | The cross-context hook that binds email-invited grants to a real `UserId` on first sign-in. **Grant resolution is now an optional backfill of `report_write_grants.grantee_user_id`** (ADR-0060 — grants match by email at check time, nothing blocks on this event). |
| `ApiKeyUsed` | Identity & Access (API auth middleware) | `AnomalyDetector` (geo / rate / failure) · AuditLogger | Cross-cutting; emitted from the edge before context code runs. |
| `ApiKeyAnomalyDetected` | Identity & Access (`AnomalyDetector`) | Notifier (admin email + dashboard banner) | Surfaces the `Anomaly` read-model. |
| `ReportVersionScanned` | Abuse & Moderation (`ScanJob`) | Reports & Folders (set `ReportVersion.scan_status`; auto-publish if `clean`) · AuditLogger | Carries the verdict (`clean`/`flagged`/`blocked`). |
| `AbuseReported` | Abuse & Moderation (`ReportAbuseUseCase`) | TriageQueueWriter · AuditLogger (admin-scoped) | An `AbuseReport` was filed. |
| `ReportTakenDown` | Abuse & Moderation (`TakedownReportUseCase`) | Reports & Folders (set `Report.deleted_at`) · BlobPurger (R2, delayed +24h) · Notifier (owner, 24h appeal) · AuditLogger | The takedown action. |
| `CspViolationReported` | Abuse & Moderation (`/csp-report` ingest) | CspReportRepository · (weekly review aggregation) | Inbound browser CSP-violation report. |

## Renames from earlier drafts

This catalog reconciles the spec (rev 7) and the DDD docs. For traceability:

| Old name(s) | Canonical | Source of the old name |
|---|---|---|
| `ReportUploaded` | `ReportVersionUploaded` | spec |
| `VersionUploaded` | `ReportVersionUploaded` | context-map draft |
| `ScanCompleted` | `ReportVersionScanned` | spec |
| `VersionScanned` | `ReportVersionScanned` | context-map / ADR-0036 |
| `LiveVersionChanged` | folded into `ReportPublished` | context-map draft |
| `AbuseReportFiled` | `AbuseReported` | context-map draft |
| `TakedownActioned` | `ReportTakenDown` | context-map draft |
| `AbuseConfirmed` | _dropped_ (never defined; the real flow is `AbuseReported` → operator triage → `ReportTakenDown`) | spec (phantom) |

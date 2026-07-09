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

**Audit rows are written synchronously per use case, not via event subscription** (ADR-0070, issue #153): every user-initiated, org-scoped mutation (`uploadReport`, `renameReport`, `moveReport`, `deleteReport`, `createFolder`, `renameFolder`, `deleteFolder`, `setAcl`, `grantWrite`, `revokeWrite`, `addComment`, `replyToComment`, `resolveComment`, `deleteComment`, `createApiKey`, `revokeApiKey`) calls `AuditLogger.record(...)` directly inside its own `uow.run` transaction, in the same commit as the state change — not as a subscriber reacting to the events below after the fact. `AuditLogger` has been removed from the subscriber column below; the event stream and its outbox transport exist for the OTHER (async, at-least-once) consumers listed per row, and for the system/webhook-driven state transitions (scan verdicts, user-deletion, identity provisioning) that stay out of the audit-log seam's scope by design (ADR-0070 §4).

---

## Catalog

| Event | Emitter (context) | Subscribers | Notes |
|---|---|---|---|
| `ReportVersionUploaded` | Reports & Folders (`UploadReportUseCase`) | enqueue `ScanJob` (Abuse & Moderation) | Every upload — first upload and every re-upload. Carries `origin: 'upload' \| 'editor'` (ADR-0062 §6, added for an edit-save's `ReportVersion`) — audit/analytics only, no consumer behavior change. The same use case also writes a `report.uploaded` `audit_log` row synchronously (ADR-0070) — not via this event. |
| `ReportPublished` | Reports & Folders (`PromoteVersionUseCase`) | CacheInvalidator (edge KV / CDN) · Notifier (welcome, **only if first publish**) | Fires whenever `live_version_id` moves. Subsumes the old `LiveVersionChanged`. |
| `AclChanged` | Reports & Folders (`UpdateAclUseCase`) | CacheInvalidator (viewer gate changed) | Sharing mode / password / allowlist change. `setAcl` also writes an `acl.set` `audit_log` row synchronously (ADR-0070) — not via this event. |
| `CollaboratorGranted` | — (never emitted) | — | **Retired (ADR-0060).** The folder-collaborator design it belonged to was never built; per-report write grants shipped (PR #150) **deliberately without a replacement event** — grants are matched at check time and confer no view access, so there is no cross-context consumer. Removed from the conformance-pinned event list in the same PR. |
| `UserCreated` | Identity & Access (Clerk webhook ACL) | Reports & Folders (resolve pending `Collaborator` `grantee_email` → `UserId`) | The cross-context hook that binds email-invited grants to a real `UserId` on first sign-in. **Grant resolution is now an optional backfill of `report_write_grants.grantee_user_id`** (ADR-0060 — grants match by email at check time, nothing blocks on this event). System-driven (webhook), out of the ADR-0070 audit-log seam's scope by design. |
| `ApiKeyUsed` | Identity & Access (API auth middleware) | `AnomalyDetector` (geo / rate / failure) | Cross-cutting; emitted from the edge before context code runs. |
| `ApiKeyAnomalyDetected` | Identity & Access (`AnomalyDetector`) | Notifier (admin email + dashboard banner) | Surfaces the `Anomaly` read-model. |
| `ReportVersionScanned` | Abuse & Moderation (`ScanJob`) | Reports & Folders (set `ReportVersion.scan_status`; auto-publish if `clean`) | Carries the verdict (`clean`/`flagged`/`blocked`). Emitted from `processScanResult`, a system-driven use case out of the ADR-0070 audit-log seam's scope by design — this event stream is its trail. |
| `AbuseReported` | Abuse & Moderation (`ReportAbuseUseCase`) | TriageQueueWriter (admin-scoped) | An `AbuseReport` was filed. |
| `ReportTakenDown` | Abuse & Moderation (`TakedownReportUseCase`) | Reports & Folders (set `Report.deleted_at`) · BlobPurger (R2, delayed +24h) · Notifier (owner, 24h appeal) | The takedown action. |
| `CspViolationReported` | Abuse & Moderation (`/csp-report` ingest) | CspReportRepository · (weekly review aggregation) | Inbound browser CSP-violation report. |
| `CommentAdded` | Authoring & Collaboration (`Comment` aggregate boundary) | — | Emitted on comment creation; delivered via the existing transactional outbox. Reserved for future Reports & Folders notification fan-out — no consumer wired there yet. ADR-0064 §6. `addComment`/`replyToComment` also write `comment.added`/`comment.replied` `audit_log` rows synchronously in the same transaction (ADR-0070) — not via this event. |
| `CommentResolved` | Authoring & Collaboration (`Comment` aggregate boundary) | — | Emitted on comment resolve; same outbox delivery, no new transport. ADR-0064 §6. `resolveComment` also writes a `comment.resolved` `audit_log` row synchronously (ADR-0070) — not via this event. |

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

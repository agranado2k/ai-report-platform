# Domain events

The canonical registry of domain events, per **ADR-0036** (Domain-Driven Design) and the spec's event-driven architecture. Term spellings follow `docs/domain-glossary.md`; the integration map is `docs/context-map.md`.

**Design rules** (from the spec):

- **Events are facts**, named in past tense (`ReportPublished`, not `PublishReport`).
- **Version-scoped events use the `ReportVersion` prefix** (`ReportVersionUploaded`, `ReportVersionScanned`) because re-uploading creates a new `ReportVersion`, never a new `Report`.
- **Payloads carry just enough** for handlers to act — usually the aggregate id and the new state. Handlers re-fetch if they need more.
- **Idempotent handlers** — every handler tolerates being invoked twice (delivery is at-least-once).
- **One commit, one event** — don't emit two ordered events from one transaction; emit one and let handlers fan out.
- **No event-driven cycles** — a handler may produce a new event but not one already on the call chain (CI static check).
- **Transport** — every emitted event is enqueued into the Postgres transactional outbox (`outbox` table, ADR-021) in the same transaction as the state change, via the `EventOutbox` port (`packages/adapters/src/event-outbox.ts`). **No dispatcher/drain exists yet** — there is no worker polling the table, so enqueued rows accumulate indefinitely with `status: 'pending'` and are never delivered. The outbox table and port are deliberately kept (not ripped out): they're the correct shape for ADR-021's at-least-once, ordered-per-aggregate delivery once a real consumer needs it. Building the dispatcher is **future work, gated on the first real cross-context consumer** — there is currently no code anywhere that reads a pending outbox row.

**Audit rows are written synchronously per use case, not via event subscription** (ADR-0070, issue #153): every user-initiated, org-scoped mutation (`uploadReport`, `renameReport`, `moveReport`, `deleteReport`, `createFolder`, `renameFolder`, `deleteFolder`, `setAcl`, `grantWrite`, `revokeWrite`, `addComment`, `replyToComment`, `resolveComment`, `editComment`, `deleteComment`, `createApiKey`, `revokeApiKey`) calls `AuditLogger.record(...)` directly inside its own `uow.run` transaction, in the same commit as the state change — not as a subscriber reacting to the events below after the fact. `AuditLogger` has been removed from the subscriber column below; the event stream and its outbox transport exist for the OTHER (async, at-least-once) consumers listed per row, and for the system/webhook-driven state transitions (scan verdicts, user-deletion, identity provisioning) that stay out of the audit-log seam's scope by design (ADR-0070 §4).

---

## Catalog

Split by whether the event is actually constructed anywhere in `packages/domain/src` today (verified by grepping `type: "EventName"` constructor sites, not just the `DomainEvent` union declaration). The `event-names` docs-conformance validator (`scripts/docs-conformance/validators/event-names.mjs`) enforces this split stays truthful: it fails if a constructed event goes undocumented here, or if an event listed as Emitted is never constructed.

### Emitted

| Event | Emitter (context) | Subscribers | Notes |
|---|---|---|---|
| `ReportVersionUploaded` | Reports & Folders (`UploadReportUseCase`) | enqueue `ScanJob` (Abuse & Moderation) | Every upload — first upload and every re-upload. Carries `origin: 'upload' \| 'editor'` (ADR-0062 §6, added for an edit-save's `ReportVersion`) — audit/analytics only, no consumer behavior change. The same use case also writes a `report.uploaded` `audit_log` row synchronously (ADR-0070) — not via this event. No consumer drains the outbox yet (see Transport above), so this row currently sits `pending`. |
| `ReportPublished` | Reports & Folders (`PromoteVersionUseCase`) | CacheInvalidator (edge KV / CDN) · Notifier (welcome, **only if first publish**) | Fires whenever `live_version_id` moves. Subsumes the old `LiveVersionChanged`. No dispatcher yet — see Transport above. |
| `CommentAdded` | Authoring & Collaboration (`Comment` aggregate boundary) | — | Emitted on comment creation; enqueued into the same transactional outbox. Reserved for future Reports & Folders notification fan-out — no consumer wired there yet (and no dispatcher to wire one to — see Transport above). ADR-0064 §6. `addComment`/`replyToComment` also write `comment.added`/`comment.replied` `audit_log` rows synchronously in the same transaction (ADR-0070) — not via this event. |
| `CommentResolved` | Authoring & Collaboration (`Comment` aggregate boundary) | — | Emitted on comment resolve; same outbox enqueue, no new transport. ADR-0064 §6. `resolveComment` also writes a `comment.resolved` `audit_log` row synchronously (ADR-0070) — not via this event. |
| `CommentEdited` | Authoring & Collaboration (`Comment` aggregate boundary) | — | Emitted when a comment's `body` and/or `intent` is edited (ADR-0064 §3); same outbox enqueue, no new transport, no consumer wired yet. `editComment` also writes a `comment.edited` `audit_log` row synchronously (ADR-0070) — not via this event. |

### Proposed (not yet emitted)

Documented in the spec / ADRs as part of the intended event catalog, but nothing in `packages/domain/src` constructs them yet — no emitter exists, so there is nothing enqueueing them into the outbox. Kept here as forward-looking design, not a current fact. Adding the constructor is what promotes a row to Emitted (and the `event-names` validator will fail the build if it's added without a matching docs update, or vice versa).

| Event | Emitter (context, when built) | Subscribers (planned) | Notes |
|---|---|---|---|
| `ReportVersionScanned` | Abuse & Moderation (`ScanJob`) | Reports & Folders (set `ReportVersion.scan_status`; auto-publish if `clean`) | Carries the verdict (`clean`/`flagged`/`blocked`). Intended to be emitted from `processScanResult`; today `processScanResult` updates `scan_status` directly and does not construct this event (see `packages/domain/src/events.ts`). |
| `AclChanged` | Reports & Folders (`UpdateAclUseCase`) | CacheInvalidator (viewer gate changed) | Sharing mode / password / allowlist change. `setAcl` writes an `acl.set` `audit_log` row synchronously (ADR-0070) today but does not construct this event. |
| `UserCreated` | Identity & Access (Clerk webhook ACL) | Reports & Folders (resolve pending `Collaborator` `grantee_email` → `UserId`) | The cross-context hook that would bind email-invited grants to a real `UserId` on first sign-in. **Grant resolution is now an optional backfill of `report_write_grants.grantee_user_id`** (ADR-0060 — grants match by email at check time, nothing blocks on this event), which is part of why it hasn't been built. |
| `ApiKeyUsed` | Identity & Access (API auth middleware) | `AnomalyDetector` (geo / rate / failure) | Cross-cutting; would be emitted from the edge before context code runs. |
| `ApiKeyAnomalyDetected` | Identity & Access (`AnomalyDetector`) | Notifier (admin email + dashboard banner) | Would surface the `Anomaly` read-model. |
| `AbuseReported` | Abuse & Moderation (`ReportAbuseUseCase`) | TriageQueueWriter (admin-scoped) | An `AbuseReport` filed. |
| `ReportTakenDown` | Abuse & Moderation (`TakedownReportUseCase`) | Reports & Folders (set `Report.deleted_at`) · BlobPurger (R2, delayed +24h) · Notifier (owner, 24h appeal) | The takedown action. |
| `CspViolationReported` | Abuse & Moderation (`/csp-report` ingest) | CspReportRepository · (weekly review aggregation) | Inbound browser CSP-violation report. |
| `CollaboratorGranted` | — (never emitted) | — | **Retired (ADR-0060).** The folder-collaborator design it belonged to was never built; per-report write grants shipped (PR #150) **deliberately without a replacement event** — grants are matched at check time and confer no view access, so there is no cross-context consumer. Removed from the conformance-pinned event list in the same PR. |

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

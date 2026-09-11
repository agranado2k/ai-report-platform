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
| `AclChanged` | Reports & Folders (`UpdateAclUseCase`) | CacheInvalidator (viewer gate changed) | Sharing mode / password / allowlist change. `setAcl` writes an `acl.set` `audit_log` row synchronously (ADR-0070) today but does not construct this event. **`setReportSharing` (ADR-0078) likewise emits NO event** — it records `report.sharing_set` plus, when the org-write row moves, `grant.org_write.granted`/`.revoked`. Its `Acl` half is the same state change this event would describe, so when `AclChanged` is finally built it must cover both writers rather than only `setAcl`. |
| `UserCreated` | Identity & Access (Clerk webhook ACL) | Reports & Folders (resolve pending `Collaborator` `grantee_email` → `UserId`) | The cross-context hook that would bind email-invited grants to a real `UserId` on first sign-in. **Grant resolution is now an optional backfill of `report_write_grants.grantee_user_id`** (ADR-0060 — grants match by email at check time, nothing blocks on this event), which is part of why it hasn't been built. **Note (ADR-0074):** the INBOUND Clerk `user.created` webhook IS now handled (`handleUserCreated` — silent domain auto-join), but it performs the join directly; no `UserCreated` domain event is constructed, so this row stays Proposed. |
| `ApiKeyUsed` | Identity & Access (API auth middleware) | `AnomalyDetector` (geo / rate / failure) | Cross-cutting; would be emitted from the edge before context code runs. |
| `ApiKeyAnomalyDetected` | Identity & Access (`AnomalyDetector`) | Notifier (admin email + dashboard banner) | Would surface the `Anomaly` read-model. |
| `AbuseReported` | Abuse & Moderation (`ReportAbuseUseCase`) | TriageQueueWriter (admin-scoped) | An `AbuseReport` filed. |
| `ReportTakenDown` | Abuse & Moderation (`TakedownReportUseCase`) | Reports & Folders (set `Report.deleted_at`) · BlobPurger (R2, delayed +24h) · Notifier (owner, 24h appeal) | The takedown action. |
| `CspViolationReported` | Abuse & Moderation (`/csp-report` ingest) | CspReportRepository · (weekly review aggregation) | Inbound browser CSP-violation report. |
| `CollaboratorGranted` | — (never emitted) | — | **Retired (ADR-0060).** The folder-collaborator design it belonged to was never built; per-report write grants shipped (PR #150) **deliberately without a replacement event** — grants are matched at check time and confer no view access, so there is no cross-context consumer. Removed from the conformance-pinned event list in the same PR. |

## Viewer-origin operational log events

Not domain events, and deliberately kept apart from the catalog above: these are **structured `console.warn` lines** emitted by the viewer origin's one gate (`apps/view/app/server/gate.server.ts`) and the two authenticated routes that consume its `Decision`. They never touch the outbox, have no subscribers, and carry no aggregate id — Vercel captures them to the function logs, which is the whole delivery mechanism. They are registered here because they are a **contract with the incident queries written against them** (ADR-0063 Phase 5-E/5-G, after two production owner lockouts): renaming one silently blinds a query, which is the failure mode that made the 2026-08-06 lockout invisible for as long as it was.

Every line is `{ event, slug, reason }` (plus `ownerFallback` on `edit-document-unopenable`). **The token is never logged** — only the boolean fact that an owner fallback was in hand.

### The degrade pairs — one per authenticated surface

An authenticated surface *degrades* when it cannot render and falls back to the public viewer, which owns the ADR-0038 §2 state machine. Each surface has two names: the plain one, and the one that says the degrade carried a **verified** owner fallback (`acceptOwnerFallback`: valid HMAC, this slug, unexpired, `owner === true`) and therefore went through the `/{slug}?access=<oa>` flow rather than dropping the visitor on a bare `/{slug}` that, for a private report, walks its own owner to the unlock wall.

| Event | Surface | Fires when | Notes |
|---|---|---|---|
| `edit-degraded-to-view` | `GET /<slug>/edit` (ADR-0063) | any degrade off the editor with **no** owner fallback in hand | The Phase 5-G signal. Every degrade off `/edit` emits exactly one line — the Phase 5-E version fired only inside `if (oa)`, so the incident that motivated it produced a `302` with zero log lines. Also emitted by `$slug_.edit.tsx` for its own post-gate `gate-decision-unusable` narrowing. |
| `owner-edit-degraded-to-view` | `GET /<slug>/edit` | the same, with a verified owner fallback | The original Phase 5-E signal, and the one incident queries for the secret-misalignment class key on. **Unchanged**, deliberately: giving the owner view its own pair below is precisely what let these two stay put. |
| `owner-view-degraded-to-view` | `GET /<slug>/view` (ADR-0089) | any degrade off the owner view with **no** owner fallback in hand | New 2026-09-10 (operator decision). The owner view previously logged under `/edit`'s two names on the argument that the degrade *class* is identical. The class is; the **surface** is not, and the surface is what an incident responder needs first — `/edit` failing is an editor problem, `/<slug>/view` failing is a *framing* problem, and once #363 flips owner-open it is the problem every owner meets, on a path where the user cannot see a URL to explain it. |
| `owner-view-owner-degraded-to-view` | `GET /<slug>/view` | the same, with a verified owner fallback | Note the scheme: `/edit` marks the owner case with an `owner-` **prefix**, but a surface already named *owner view* prefixed that way reads `owner-owner-view-…`, so the marker moves **behind** the surface token. The dividend is a property `/edit`'s pair does not have — the single prefix `owner-view-` selects the whole surface in a log query. Emitted by the gate, and by `$slug_.view.tsx` for its own `gate-decision-unusable` narrowing. |

### The document-failure line

| Event | Surface | Fires when | Notes |
|---|---|---|---|
| `edit-document-unopenable` | `GET /<slug>/edit` | the capability is already proven and the live version's document cannot be opened in the editor (`document-unreadable` / `document-unsplittable` / `document-unparsable`) | A **distinct** event because it no longer degrades to the view at all: `/edit` answers `409` with its own explanatory page (`apps/view/app/edit/unopenable.ts`). `*-degraded-to-view` naming an outcome that never reaches the view is exactly the drift this event was split off to remove, and the two are operationally different — a degrade is the incident class (an owner silently stranded), this is a handled outcome the user was told about. Carries an extra `ownerFallback` boolean recording whether the page could offer a *working* read-only link. |

### The shared `reason` vocabulary

One taxonomy of "why the authenticated render failed", across **both** surfaces and both outcomes — deliberately not re-cut per surface, so ADR-0063's open question (which reason actually fires in production) stays answerable across all of them. `DocumentDegradeReason` (`apps/view/app/edit/load-document.ts`) is `Extract`ed from it, so the two cannot drift.

| `reason` | Meaning |
|---|---|
| `edit-token-denied` | No / invalid / expired capability (query token or cookie), and no funnel to the app's mint was available. |
| `app-origin-unset` | `APP_ORIGIN` is unset on the view deployment — env at fault, not the report. Both authenticated routes fail closed: their header profile needs it for `connect-src`. |
| `no-servable-version` | The report has no clean live version (missing / mid-scan / flagged / deleted). |
| `lookup-failed` | The report lookup itself failed (infra). |
| `gate-decision-unusable` | The route could not use the `Decision` it was handed — unreachable by construction; it exists so that if it ever fires it is named rather than silent. Emitted route-side, never by the gate. |
| `document-unreadable` · `document-unsplittable` · `document-unparsable` | The three `edit-document-unopenable` reasons: the blob read, the shell/body split, and the ProseMirror parse. Never degrade to the view. |

---

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

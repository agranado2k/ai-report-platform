# Domain glossary — Ubiquitous Language

The registry of canonical terms for `ai-report-platform`, per **ADR-0036** (Domain-Driven Design). Use these spellings and meanings consistently across code (type names, function names), commit messages, PR titles, ADRs, the diary, and conversations.

**Adding a term**: introduce it in the same PR that first uses it in code. Cross-reference the spec section that defines its behavior. Prefer business names over technical ones (`slug`, not `id`).

**Changing a term**: rename across the codebase in a single PR. Update this glossary in the same commit. Do NOT leave aliases — the point of Ubiquitous Language is that there is exactly one name per concept.

> **Source of truth.** This glossary, `docs/context-map.md`, and ADR-0036 are the canonical source for domain *language*. Where `docs/spec.html` (rev 7) disagrees, this glossary wins and the spec is synced to it (see the diary entry "Domain-language alignment — spec rev 8 sync"). The spec still wins on *architecture* decisions; this carve-out is for naming only.

---

## Reports & Folders context

- **Report** — a versioned HTML document published to the platform under a permanent slug. Owned by an `Org` and located under a `Folder`. Aggregate root. Spec: ADR-001 + Architecture / Data model.
- **Slug** — the permanent, URL-safe `nanoid(10)` identifier for a `Report`. Globally unique across the platform. Cannot change after creation. Value Object. In `public` ACL mode the slug is also the access **capability** (~10¹⁸ entropy = unguessable "anyone with the link"); it is not a discoverable id. Spec: ADR-001, ADR-0038.
- **ReportVersion** — a single snapshot of a `Report`'s content. A `Report` has one or more `ReportVersion`s and points to a `live_version_id`. Re-uploading creates a new `ReportVersion`, never a new `Report`. Part of the `Report` aggregate. Persisted in `report_versions`. Spec: ADR-001.
  - _Avoid_: Version (ambiguous on its own — always `ReportVersion`).
- **Entry document** — the file served at the bare `view.<domain>/<slug>` (the root of a `ReportVersion`'s bundle). Resolved by the `index.html` convention: a single `.html` upload is normalized to `index.html`, and a single wrapping directory in the archive is stripped. Spec: ADR-007, ADR-0037.
- **Live version** — the `ReportVersion` served at the base viewer URL (`view.<domain>/<slug>`). Older versions remain reachable at `?v=N`. Tracked by `Report.live_version_id`.
- **Scan status** — a Value Object on a `ReportVersion` recording the moderation verdict: `pending`, `clean`, `flagged`, `blocked`. Only a `clean` version may become the `live_version_id`. It is a **denormalized cache** of the `ScanJob` outcome (the `ScanJob` aggregate is owned by Abuse & Moderation); Reports & Folders updates it on the `ReportVersionScanned` event. Spec: ADR-012.
- **Folder** — a tree-structured organizing unit inside an `Org`. Folders nest. A `Report` belongs to exactly one `Folder`. Aggregate root; the `Folder` aggregate owns the folder tree and its `Collaborator` grant chain. Spec: Architecture / Data model.
- **Root folder** — the single top-level `Folder` of an `Org` (`parent_id = NULL`). A `Report` created without an explicit `folder_path` is placed here. Spec: ADR-0037.
- **Collaborator** — a `User` granted access to a `Folder` outside their own `Org` (or inside it). Grants are inherited by descendant folders and reports. Part of the `Folder` aggregate (owned by Reports & Folders); the grantee is referenced by `UserId`/email via the shared kernel. Spec: ADR-009.
- **Grant level** — a Value Object carried by a `Collaborator` grant: `editor` or `admin` (persisted as `folder_collaborators.permission`). Distinct from an `ApiKey` `Scope`. Spec: ADR-009.
- **Acl** (Access Control List) — per-`Report` sharing configuration. Part of the `Report` aggregate (one `Acl` per `Report`). Modes (`AclMode`): `public`, `password`, `org`, `allowlist`. Spec: User-facing summary / Sharing modes.
  - _Spell out_ "ACL" only when expanding the acronym in prose; the type/term is `Acl`.

## Identity & Access context

- **User** — an authenticated principal mirrored from Clerk. Identified by a `UserId`. Belongs to one or more `Org`s. Spec: ADR-005.
- **Org** (Organization) — the tenancy unit. Owns folders, reports, and API keys. Every `User` has a personal `Org` by default. Identified by `OrgId`. Carries a `Plan` and its `PlanLimits`. Spec: ADR-005.
- **Plan** — the billing tier on an `Org` (enum; e.g. `free`, `pro`). Billing-ready, billing-deferred for v1. Spec: ADR-006.
- **PlanLimits** — a Value Object holding the quota ceilings a `Plan` grants an `Org` (e.g. report count, storage, per-report CSP opt-in). Persisted as `orgs.plan_limits_json`. Enforced by `PlanLimiter` in the Application layer. Spec: ADR-006.
- **ApiKey** — a credential issued to a `User` that acts on their behalf when calling the HTTP API. Hashed (argon2id), prefixed for display, scoped per ADR-016. User-scoped (`acting_user_id`) so cross-org collaboration works. Spec: ADR-008.
- **Scope** — a permission carried by an `ApiKey`: `reports:write`, `reports:read`, `folders:write`, `acl:write`. Distinct from a `Collaborator` `Grant level`. Spec: ADR-016.
- **UploadActor** — the resolved caller identity the transport layer presents to the `uploadReport` use case. Carries `UserId`, `OrgId`, `FolderId` (the target folder), and the validated `ApiKey` `Scope`s. Resolved by `resolveUploadActor` at the HTTP boundary — Phase-1 returns a seeded `DEMO_ACTOR`, real API-key / Clerk auth slots in behind the same signature (401 / 403) without the use-case changing. Spec: ADR-016.
- **Anomaly** — a read-model over `ApiKey` usage flagged as suspicious by the `AnomalyDetector` (geo shift, rate spike, repeated auth failure). Drives an admin alert; does not block requests synchronously in v1. Spec: ADR-016.
- **AnomalyDetector** — the domain service that evaluates `ApiKeyUsed` events against historical baselines and emits `ApiKeyAnomalyDetected`. Spec: ADR-016.

## Abuse & Moderation context

- **ScanJob** — the aggregate tracking the upload-time content scan of a `ReportVersion` through its lifecycle (`queued` → `running` → `done` / `failed`). Owns the scan `findings` (ClamAV + phishing/miner heuristics). On completion it emits `ReportVersionScanned` carrying the verdict; Reports & Folders caches that verdict on `ReportVersion.scan_status`. Spec: ADR-012.
- **Scanner** — the port (verdict engine) a `ScanJob` runs a `ReportVersion` through to obtain its terminal verdict (`clean` / `flagged` / `blocked`). Phase-1.5a: `CleanStubScanner` always returns `clean` (invite-only MVP); the real ClamAV + phishing/miner engine slots in behind the same port with no call-site change. Spec: ADR-0045.
- **ScanWorkQueue** — the delivery port that hands queued `ReportVersion`s to the async scan worker (the drain) and tracks ack/retry; distinct from `ScanJob`/`scan_jobs`, which remain the source of truth for the cached `scan_status`. Implemented on pg-boss; swappable. Spec: ADR-0045.
- **Abuse report** — a user-submitted complaint about a hosted `Report` (phishing, malware, CSAM, other). Aggregate root. Tracked with `status` and an action audit trail. Spec: ADR-012.
- **Takedown** — the operator action that withdraws a `Report` from public serving. Emits `ReportTakenDown`; Reports & Folders soft-deletes the `Report` row (`deleted_at`) and the R2 keys are queued for purge after the appeal window. Spec: ADR-012.
- **CSP report** — an inbound Content-Security-Policy violation report sent by viewer browsers to `/csp-report`. Used for policy drift detection. Spec: ADR-013.

## Shared kernel

Terms used identically across all three contexts.

- **UserId** — branded type for `User` identifiers. Originates in Clerk; mirrored on `users.id`.
- **OrgId** — branded type for `Org` identifiers. Originates in Clerk; mirrored on `orgs.id`.
- **Timestamp** — UTC `Date` (millisecond precision). All persisted timestamps are stored as Postgres `timestamptz`.

## Domain events

Event names are the contract; their full catalog (emitter, subscribers, payload) lives in `docs/events.md`. Events are facts in past tense.

- Reports & Folders emits: `ReportVersionUploaded`, `ReportPublished`, `AclChanged`, `CollaboratorGranted`.
- Identity & Access emits: `UserCreated`, `ApiKeyUsed`, `ApiKeyAnomalyDetected`.
- Abuse & Moderation emits: `ReportVersionScanned`, `AbuseReported`, `ReportTakenDown`, `CspViolationReported`.

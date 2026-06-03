# Domain glossary — Ubiquitous Language

The registry of canonical terms for `ai-report-platform`, per **ADR-0036** (Domain-Driven Design). Use these spellings and meanings consistently across code (type names, function names), commit messages, PR titles, ADRs, the diary, and conversations.

**Adding a term**: introduce it in the same PR that first uses it in code. Cross-reference the spec section that defines its behavior. Prefer business names over technical ones (`slug`, not `id`).

**Changing a term**: rename across the codebase in a single PR. Update this glossary in the same commit. Do NOT leave aliases — the point of Ubiquitous Language is that there is exactly one name per concept.

---

## Reports & Folders context

- **Report** — a versioned HTML document published to the platform under a permanent slug. Owned by an `Org` and located under a `Folder`. Spec: ADR-001 + Architecture / Data model.
- **Slug** — the permanent, URL-safe `nanoid(10)` identifier for a `Report`. Globally unique across the platform. Cannot change after creation. Spec: ADR-001.
- **Version** — a single snapshot of a `Report`'s content. A `Report` has one or more `Version`s and points to a `live_version_id`. Re-uploading creates a new `Version`, never a new `Report`. Spec: ADR-001.
- **Folder** — a tree-structured organizing unit inside an `Org`. Folders nest. A `Report` belongs to exactly one `Folder`. Spec: Architecture / Data model.
- **Acl** (Access Control List) — per-`Report` sharing configuration. Modes: `public`, `password`, `org`, `allowlist`. Spec: User-facing summary / Sharing modes.
- **Live version** — the `Version` served at the base viewer URL (`view.<domain>/<slug>`). Older versions remain reachable at `?v=N`.

## Identity & Access context

- **User** — an authenticated principal mirrored from Clerk. Identified by a `UserId`. Belongs to one or more `Org`s. Spec: ADR-005.
- **Org** (Organization) — the tenancy unit. Owns folders, reports, and API keys. Every `User` has a personal `Org` by default. Identified by `OrgId`. Spec: ADR-005.
- **ApiKey** — a credential issued to a `User` that acts on their behalf when calling the HTTP API. Hashed (argon2id), prefixed for display, scoped per ADR-016. Spec: ADR-008.
- **Scope** — a permission carried by an `ApiKey`: `reports:write`, `reports:read`, `folders:write`, `acl:write`. Spec: ADR-016.
- **Collaborator** — a `User` granted write access to a `Folder` outside their own `Org` (or inside it). Grants are inherited by descendant folders and reports. Spec: ADR-009.

## Abuse & Moderation context

- **Scan status** — the result of upload-time content scanning for a `Version`. Values: `pending`, `clean`, `flagged`, `blocked`. Determines whether the `Version` is publicly served. Spec: ADR-012.
- **Abuse report** — a user-submitted complaint about a hosted `Report` (phishing, malware, CSAM, other). Tracked with `status` and an action audit trail. Spec: ADR-012.
- **Takedown** — the operator action that withdraws a `Report` from public serving. Soft-deletes the `Report` row and queues its R2 keys for purge. Spec: ADR-012.
- **CSP report** — an inbound Content-Security-Policy violation report sent by viewer browsers to `/csp-report`. Used for policy drift detection. Spec: ADR-013.

## Shared kernel

Terms used identically across all three contexts.

- **UserId** — branded type for `User` identifiers. Originates in Clerk; mirrored on `users.id`.
- **OrgId** — branded type for `Org` identifiers. Originates in Clerk; mirrored on `orgs.id`.
- **Timestamp** — UTC `Date` (millisecond precision). All persisted timestamps are stored as Postgres `timestamptz`.

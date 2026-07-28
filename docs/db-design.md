# Database design

The detailed schema reference for Centaur Spec (Postgres on Neon). The
`docs/spec.html` "Database design" section (rev 8) defines the table catalog and
is the **contract**; this doc is the column-level reference the Drizzle schema
(`packages/db`, ADR-020) is generated from. Where the two disagree, the spec
wins — fix this doc and flag it.

Bounded contexts (ADR-0036): **Reports & Folders** owns the content that belongs
to each `Org` (`folders`, `reports`, `report_versions`, `acls`,
`folder_collaborators`); **Identity & Access** owns `orgs`, `users`, `api_keys`;
**Abuse & Moderation** owns `scan_jobs`, `abuse_reports`, `csp_reports`;
**Authoring & Collaboration** (ADR-0064) owns `comments`. `outbox` / `audit_log`
are cross-cutting infrastructure. The only shared-kernel ids are `UserId`/`OrgId`.

## Conventions

- **Ids**: UUIDv7 primary keys (`id`), time-ordered and index-friendly. Slugs
  are separate, URL-facing identifiers — never the primary key.
- **Timestamps**: `timestamptz` (UTC), millisecond precision.
- **Soft delete**: `deleted_at timestamptz NULL` on user-visible resources
  (`orgs`, `folders`, `reports`, `users`). Hard purge is a scheduled job after the
  appeal window. Queries filter `deleted_at IS NULL`. For `users` the delete is
  terminal (never resurrected, ADR-0054); the `clerk_user_id` unique index is
  deliberately full (non-partial) so the soft-deleted row keeps its slot.
- **Tenant isolation**: every owned-row query filters by `org_id`, enforced in
  the repositories (ADR-020). A custom ESLint rule flags a raw select on a
  tenant table without an `org_id` predicate.
- **JSONB**: only for shapes never queried individually (`manifest_json`,
  `plan_limits_json`, `scopes`, `findings`, `meta_json`, `allowed_emails`,
  `csp_extras`). Anything we filter or aggregate on gets a real column.
- **Foreign keys**: `ON DELETE RESTRICT` by default; `ON DELETE CASCADE` only on
  `report_versions → reports`, `acls → reports`, `report_grants → reports`,
  `scan_jobs → report_versions`, `comments → reports`, and `comments →
  comments` (the self-FK `parent_comment_id` — JUDGMENT CALL, ADR-0064: a
  thread's replies are owned by its root the same way versions are owned by
  their report, so deleting the root cascades its replies rather than leaving
  them FK-orphaned under the RESTRICT default). The app soft-deletes; cascades
  defend against accidental hard-deletes via migrations (and keep the
  `reports → report_versions → scan_jobs` chain consistent under a hard purge).
- **Nullability**: every column is `NOT NULL` unless its Notes say `NULL`. All FK
  columns (e.g. `report_versions.report_id`, `scan_jobs.report_version_id`,
  `folders.org_id`) are `NOT NULL` except where explicitly marked nullable
  (`folders.parent_id`, `reports.live_version_id`, `folder_collaborators.grantee_user_id`).
- **Partitioning**: `audit_log` (by `at`) and `outbox` (by `created_at`) are
  *targeted* for monthly partitioning; old partitions detached and cold-exported.
  **Deferred in Phase 1** — Drizzle's schema DSL can't express `PARTITION BY`, so
  these ship as plain tables now and are converted to partitioned tables via a
  custom migration when they go hot (neither is write-heavy until the
  audit/outbox dispatcher lands). Tracked as a follow-up.
- **Migrations**: **forward-only** (Drizzle generates no down files). Every PR
  ships the generated up migration; rollback is by **Neon branch reset / PITR**,
  not a down-migration (the CI migration-check's "rollback" is deleting the
  ephemeral branch). Pair with **expand/contract** discipline — no destructive
  change in a single migration — so forward-only stays safe (ADR-019).

## Enums

| Enum | Values |
|---|---|
| `plan` | `free`, `pro` |
| `org_kind` | `personal`, `team` (ADR-0061, derived at provisioning by ADR-0068 §1's domain-keyed rule; default `personal`; migration `0014`) |
| `grant_level` | `editor`, `admin` — **superseded, unused** (ADR-0060; write grants have one implicit level) |
| `scan_status` | `pending`, `clean`, `flagged`, `blocked` |
| `version_origin` | `upload`, `editor` (ADR-0062 §6, ADR-0065; default `upload`) |
| `scan_job_status` | `queued`, `running`, `done`, `failed` |
| `acl_mode` | `private`, `public`, `password`, `org`, `allowlist` |
| `idempotency_state` | `in_flight`, `completed` |
| `abuse_status` | `open`, `actioned`, `dismissed` |
| `outbox_status` | `pending`, `delivered`, `failed` |

`api_keys.scopes` is a JSONB string array (`reports:write`, `reports:read`,
`folders:write`, `acl:write`), not an enum — it holds a set per key.

## Tables

### Identity & Access

#### `orgs` — tenant root
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | UUIDv7 |
| `clerk_org_id` | text | unique; mirror of Clerk org |
| `name` | text | |
| `kind` | `org_kind` | `personal` / `team` (ADR-0061/0068); default `personal`; set at JIT provisioning by the domain rule (migration `0014`) |
| `plan` | `plan` | default `free` |
| `plan_limits_json` | jsonb | quota ceilings (`PlanLimits`, ADR-006) |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz NULL | soft delete |

Indexes: `clerk_org_id` unique, `plan`, `kind`.

#### `users` — mirror of Clerk
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | UUIDv7 |
| `clerk_user_id` | text | unique |
| `email` | text | denormalized for pre-signup grant resolution |
| `display_name` | text NULL | human name mirrored from Clerk at JIT provisioning (fullName / firstName lastName / username), for author display (ADR-0048 identity mirror); NULL when Clerk exposes none |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz NULL | Clerk `user.deleted` → soft delete (ADR-0054); terminal — never resurrected |

Indexes: `clerk_user_id` unique, `email`, `deleted_at` partial (`WHERE deleted_at IS NOT NULL`, purge-job lookup — mirrors reports, ADR-0054).

#### `api_keys`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `acting_user_id` | uuid FK → users | **user-scoped** so cross-org collaboration works |
| `issued_in_org_id` | uuid FK → orgs | org the key was minted in |
| `name` | text | |
| `scopes` | jsonb | OAuth-style scope set |
| `key_prefix` | varchar(12) | plaintext, shown in UI |
| `key_hash` | text | HMAC-SHA-256 + server pepper (ADR-0008) |
| `last_used_at` | timestamptz NULL | |
| `revoked_at` | timestamptz NULL | soft delete |
| `created_at` | timestamptz | |

Indexes: `key_prefix`, `acting_user_id`, `last_used_at`.

### Reports & Folders

#### `folders` — tree
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK → orgs | |
| `parent_id` | uuid FK → folders NULL | self-reference; `NULL` = root folder; max depth 8 (app-enforced) |
| `name` | text | |
| `slug` | text | |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz NULL | |

Indexes: `org_id`, `(org_id, id DESC) WHERE deleted_at IS NULL` (cursor-paginated `searchByOrg`, keyset on the folder id, ADR-0053), `(org_id, parent_id, slug) WHERE deleted_at IS NULL` unique, and `(org_id, slug) WHERE parent_id IS NULL AND deleted_at IS NULL` unique (one Root folder per slug per org — the base index can't dedupe `parent_id = NULL` rows, ADR-0048). Both exclude soft-deleted rows so a deleted folder doesn't keep its sibling-slug slot (recreating a same-named folder must succeed, ADR-0036).

#### `folder_collaborators` — **superseded, unused** (ADR-0060; was ADR-009 / ADR-0056 P4)

Never gained behavioral code; per-report `report_write_grants` replaces the design. The table (and `grant_level`) stays in the schema until a cleanup migration drops it (expand/contract — not dropped in the ownership epic).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `folder_id` | uuid FK → folders | inherited by descendants |
| `grantee_user_id` | uuid FK → users NULL | NULL until invitee signs up; resolved on `UserCreated` |
| `grantee_email` | text | |
| `permission` | `grant_level` | `editor` / `admin` |
| `added_by` | uuid FK → users | |
| `added_at` | timestamptz | |

Indexes: `folder_id`, `grantee_email`, `(folder_id, grantee_email)` unique.

#### `reports` — aggregate root
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK → orgs | tenancy home |
| `owner_id` | uuid FK → users **ON DELETE RESTRICT** | the creating user = the `Owner` (ADR-0059); backfilled from the version-1 `uploaded_by_user`; NOT NULL after backfill (migration 0010) |
| `folder_id` | uuid FK → folders | placement at create (ADR-0037); **mutable** — reassigned by the move-report operation (ADR-0036) |
| `slug` | varchar(10) | immutable `nanoid(10)`; the public URL + capability (ADR-0038) |
| `title` | text | |
| `live_version_id` | uuid FK → report_versions NULL | the served version; flips on scan-clean (monotonic, ADR-0037 §8) |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz NULL | takedown → soft delete |

Indexes: `slug` unique, `(org_id, folder_id)`, `(org_id, id DESC) WHERE deleted_at IS NULL` (serves the cursor-paginated org-wide listing/search — `searchByOrg`, keyset on the report id, ADR-0053), `(org_id, updated_at DESC) WHERE deleted_at IS NULL` (retained for any `updated_at`-ordered access), `owner_id` (ADR-0059), `deleted_at` partial.
The `reports.live_version_id ↔ report_versions.report_id` cycle is broken by
making `live_version_id` nullable and set after the first version commits.

#### `report_versions` — one row per upload (a `ReportVersion`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | the `versionId` in the R2 key |
| `report_id` | uuid FK → reports **ON DELETE CASCADE** | |
| `version_no` | int | display ordinal = `max+1` at commit (ADR-0037 §6) |
| `manifest_json` | jsonb | files: paths + R2 keys + content-types |
| `size_bytes` | bigint | uncompressed total |
| `content_hash` | text | integrity + dominant input to the derived idempotency key (ADR-0039) |
| `uploaded_by_user` | uuid FK → users | |
| `scan_status` | `scan_status` | default `pending`; **denormalized cache** of the `ScanJob` verdict, updated on `ReportVersionScanned` |
| `uploaded_at` | timestamptz | |
| `origin` | `version_origin` | `upload` \| `editor` (ADR-0062 §6, ADR-0065); default `upload`, NOT NULL. Every row is `upload` today — the in-app editor doesn't exist yet (migration 0011) |

Indexes: `report_id`, `(report_id, version_no)` unique, `scan_status`.

> **Rev-8 change:** `scan_findings` and `scanned_at` are **removed** from this
> table — the detailed findings now live on `scan_jobs`, and `scan_status` is
> just the cached verdict. Phase 1's migration creates this table without those
> two columns.

#### `acls` — one row per report
| Column | Type | Notes |
|---|---|---|
| `report_id` | uuid PK / FK → reports **ON DELETE CASCADE** | 1:1 with reports |
| `mode` | `acl_mode` | column default `public` (legacy/unused — set_acl always writes a mode). **Private-by-default is app-enforced**: a missing `acls` row loads as `private` (ADR-0056) |
| `password_hash` | text NULL | argon2id, password mode |
| `allowed_emails` | jsonb NULL | allowlist mode |
| `access_ttl_seconds` | integer NULL | owner-set access duration for allowlist grants (ADR-0056); null for other modes |
| `csp_extras` | jsonb NULL | **Reserved, currently unmapped** — no domain/adapter code reads or writes it. Held for the ADR-006 paid-plan per-report CSP opt-in; keep the column (do not drop) until that feature lands |
| `updated_at` | timestamptz | |

#### `report_grants` — durable, revocable allowlist access grants (ADR-0056, revocation-C)
| Column | Type | Notes |
|---|---|---|
| `report_id` | uuid FK → reports **ON DELETE CASCADE** | part of the PK |
| `email` | text | the allowlisted viewer; part of the PK |
| `granted_at` | timestamptz | set/refreshed on magic-link redeem |
| `expires_at` | timestamptz | `granted_at + acl.access_ttl_seconds`; the viewer checks `> now()` per request |

PK `(report_id, email)` — one grant per allowlisted viewer; redeem upserts. Created on redeem; the viewer's per-request `isGranted` check is what makes revocation immediate (removing the email / switching mode deletes the row). `report_grants_expires_at_idx` supports the expired-row purge job.

#### `report_write_grants` — per-report write grants (ADR-0060; lands with the write-grants build)
| Column | Type | Notes |
|---|---|---|
| `report_id` | uuid FK → reports **ON DELETE CASCADE** | part of the PK |
| `grantee_email` | text | normalized (`EmailAddress`); part of the PK |
| `grantee_user_id` | uuid FK → users NULL | resolved lazily — set at grant time if the user exists, else matched by email at check time |
| `granted_by` | uuid FK → users | the `Owner` who granted |
| `granted_at` | timestamptz | |

PK `(report_id, grantee_email)`; index `grantee_email`. No expiry (persists until revoked), no `permission` level (one implicit level: rename + re-upload + move — ADR-0060), no surrogate id (wire-addressed as `(slug, email)`). View access is NOT conferred — the read capability stays with the `Acl`.

### Authoring & Collaboration

#### `comments` — the `Comment` aggregate (ADR-0064, added migration 0013; `intent` added migration 0015)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `report_id` | uuid FK → reports **ON DELETE CASCADE** | the report this comment/thread belongs to |
| `author_user_id` | uuid FK → users | who wrote it |
| `parent_comment_id` | uuid FK → comments NULL, **ON DELETE CASCADE** | NULL = root (starts a Thread); set = a reply. Single-level threading enforced at the application layer (ADR-0064 Decision 2), not a self-join depth constraint. The self-FK is CASCADE — see the Conventions FK-policy note above |
| `body` | text | bounded to 2000 chars at the domain layer (JUDGMENT CALL — ADR-0064 says "bounded... a short annotation," no number given) |
| `intent` | `comment_intent` enum **NOT NULL DEFAULT 'note'** | what the author wants done with the comment (ADR-0064 Decision 8): `note` (default) / `enhancement` / `add` / `remove`. Migration 0015 backfills every existing row to `note`; a legacy value degrades to `note` on read |
| `anchor_json` | jsonb | the `Anchor` value object (ADR-0064 §2a): `{ version_pinned: { version_id, text_quote }, relative? }` — `relative` is an opaque, optional Yjs-relative-position slot the editor slice will populate later |
| `resolved_at` | timestamptz NULL | NULL = open; set = resolved (idempotent transition — resolving twice doesn't change it) |
| `created_at` | timestamptz | |

| `edited_at` | timestamptz NULL | migration 0017 — set to the last edit time when `body`/`intent` is changed (surfaces an "· edited" indicator); also the optimistic-concurrency token (`expected_edited_at` → 409). NULL = never edited |

Indexes: `report_id`, `(report_id, id DESC)` (keyset pagination for `listComments`, ADR-0053), `parent_comment_id`. `body`/`intent` ARE editable (edit-comment use case, migration 0017 added `edited_at`); the anchor stays immutable. `resolved_at` mutates via `save()`'s upsert.

### Abuse & Moderation

#### `scan_jobs` — the `ScanJob` aggregate (added rev 8)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `report_version_id` | uuid FK → report_versions **ON DELETE CASCADE** | unique (one job per version) |
| `status` | `scan_job_status` | `queued` → `running` → `done`/`failed` |
| `verdict` | `scan_status` NULL | the outcome when `done` (`clean`/`flagged`/`blocked`) |
| `findings` | jsonb NULL | ClamAV + phishing/miner heuristics |
| `started_at` / `finished_at` | timestamptz NULL | |
| `created_at` | timestamptz | |

Indexes: `report_version_id` unique, `status`.
On completion the job emits `ReportVersionScanned`; Reports & Folders caches the
verdict on `report_versions.scan_status`. **Phase 1 uses a stub** (see below).

#### `abuse_reports` (Phase 1.5)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `report_id` | uuid FK → reports | |
| `reporter_ip_hash` | text | SHA-256(IP + daily salt) — per-IP reasoning without raw IPs |
| `reason` | text | |
| `notes` | text NULL | |
| `status` | `abuse_status` | triage queue |
| `created_at` | timestamptz | |
| `actioned_by` | uuid FK → users NULL | |
| `actioned_at` | timestamptz NULL | |

Indexes: `report_id`, `status`, `created_at`.

#### `csp_reports` (Phase 1.5)
Inbound browser CSP-violation reports posted to `/csp-report`; 90-day retention;
aggregated weekly for drift.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `report_slug` | text | the slug whose page violated CSP |
| `document_uri` | text | |
| `violated_directive` | text | |
| `blocked_uri` | text | |
| `source_file` | text NULL | |
| `line_no` | int NULL | |
| `raw` | jsonb | full report payload |
| `received_at` | timestamptz | |

Indexes: `violated_directive`, `received_at`.

### Cross-cutting infrastructure

#### `idempotency_keys` (added rev 8, ADR-0039)
| Column | Type | Notes |
|---|---|---|
| `acting_user_id` | uuid FK → users | part of PK |
| `route` | text | part of PK |
| `key` | text | part of PK (header value or server-derived) |
| `request_fingerprint` | text | canonical-request hash; mismatch on reuse → 422 |
| `response_status` | int NULL | stored for replay |
| `response_body` | jsonb NULL | stored for replay |
| `state` | `idempotency_state` | `in_flight` → `completed` |
| `created_at` | timestamptz | 24h TTL, swept |

Primary key: `(acting_user_id, route, key)`. Index: `created_at` (sweep).
Written **in the same transaction** as the mutation + outbox row (Postgres, not
Redis) so the record can't desync from the data after a crash.

#### `outbox` — transactional outbox
`id` PK, `event_type`, `aggregate_id` uuid, `payload` jsonb, `status`
(`outbox_status`), `attempts` int default 0, `available_at` timestamptz (delayed
dispatch, e.g. R2 purge at takedown+24h), `created_at`, `delivered_at` NULL.
Indexes: `(status, available_at)`, `aggregate_id`. Partitioned monthly. Drained
by the dispatcher (~1s poll). Carries the canonical events in `docs/events.md`.

#### `audit_log` — append-only
`id` PK, `org_id`, `actor_user_id` FK → users NULL, `action`, `target_type`,
`target_id`, `meta_json` jsonb, `ip_hash` NULL, `geo` NULL, `at` timestamptz.
Indexes: `(org_id, at)`, `actor_user_id`. Partitioned monthly; 1-year hot
retention; cold-export at month-roll. Every **user-initiated org-scoped**
mutation writes a row, synchronously in the same transaction as the mutation
(ADR-0070); system/webhook state transitions (scan results, user-deletion
webhook, identity provisioning) are captured as **domain events** (outbox),
not audit rows.

`action`/`target_type`/`target_id` are free `text` columns (no DB enum) — the
app writes from the closed `AuditAction` union in
`packages/application/src/audit.ts`. The vocabulary, grouped by resource:

- **report**: `report.uploaded`, `report.renamed`, `report.moved`, `report.deleted`
- **folder**: `folder.created`, `folder.renamed`, `folder.deleted`
- **acl**: `acl.set`
- **grant**: `grant.write.granted`, `grant.write.revoked`
- **comment**: `comment.added`, `comment.replied`, `comment.resolved`, `comment.deleted`
- **api_key**: `api_key.created`, `api_key.revoked`

## R2 object layout (ADR-0037)

Blobs are keyed `reports/<reportId>/<versionId>/<path>` — `versionId` is the
`report_versions.id` UUID, **not** the `version_no` ordinal. Upload writes all
blobs first, then commits the DB row + outbox + idempotency record in one
transaction (commit-last); a pre-commit failure leaves only unreferenced blobs,
reclaimed by a GC sweep.

## Phase 1 scope

**Created by the Phase-1 migration and actively written:** `orgs`, `users`,
`api_keys`, `folders` (root only), `reports`, `report_versions`, `acls`,
`idempotency_keys`, `outbox`, `audit_log`, `scan_jobs` (via the stub below).

**Created but not yet exercised until later phases:** `folder_collaborators`
(Phase 2.5), `abuse_reports` / `csp_reports` (Phase 1.5). They land in the
schema now so the FK graph is complete and migrations don't churn.

### Phase 1 scan stub

Phase 1 ships core upload + viewer; the real scanner (ADR-0012: ClamAV +
phishing/miner heuristics) is Phase 1.5. To let a version go live, **Phase 1
uses a scan stub that always produces a `clean` verdict**: on upload it creates
a `scan_jobs` row, drives it `queued → done` with `verdict='clean'`, and emits
`ReportVersionScanned(clean)`. That caches `report_versions.scan_status='clean'`
and triggers monotonic promotion (ADR-0037 §8), so the viewer has a live version
to serve. The promotion *machinery* is built for real — only the verdict source
is hardcoded; `flagged`/`blocked` paths exist but never fire in Phase 1. When
Phase 1.5 lands the real scanner, the stub is replaced behind the scan port; no
promotion-logic change should be needed.

## Migrations

Drizzle (`drizzle-kit`) under `packages/db`, **forward-only** (no down files).
Every PR ships the generated up migration; CI applies it to a throwaway Neon
branch (and discards the branch — that deletion is the "rollback") before merge.
Rollback in prod is a Neon branch reset / PITR, paired with expand/contract
discipline. The first Phase-1 migration creates every table above.

Migrations run **only through CI/CD — never by hand** (ADR-017/019). Two
workflows, both driven by the Neon API (`NEON_API_KEY` secret + `NEON_PROJECT_ID`
variable), so no `DATABASE_URL` is ever stored or run locally:

- **`migration-check.yml`** (PR, on `packages/db/**`): `drizzle-kit check` for
  folder/journal consistency, then create an ephemeral Neon branch → apply the
  full migration set → delete the branch (the verification gate).
- **`migrate-db.yml`** (**migrate-on-deploy — every push to `main`**, plus
  `workflow_dispatch`): resolve the prod (default `main`) branch's connection URI
  from the Neon API and apply pending migrations — the single path that mutates
  the prod DB. `drizzle-kit migrate` is idempotent, so it's a no-op when prod is
  current and self-heals when it's behind (e.g. after a Neon branch reset wiped
  the schema). It runs on *every* merge, not just `packages/db/**` changes,
  because an infra-driven DB reset has no schema-file change to ride on.
  Serialized via a `migrate-db-prod` concurrency group so two applies never race.

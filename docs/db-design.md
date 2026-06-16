# Database design

The detailed schema reference for `ai-report-platform` (Postgres on Neon). The
`docs/spec.html` "Database design" section (rev 8) defines the table catalog and
is the **contract**; this doc is the column-level reference the Drizzle schema
(`packages/db`, ADR-020) is generated from. Where the two disagree, the spec
wins — fix this doc and flag it.

Bounded contexts (ADR-0036): **Reports & Folders** owns the content that belongs
to each `Org` (`folders`, `reports`, `report_versions`, `acls`,
`folder_collaborators`); **Identity & Access** owns `orgs`, `users`, `api_keys`;
**Abuse & Moderation** owns `scan_jobs`, `abuse_reports`, `csp_reports`. `outbox`
/ `audit_log` are cross-cutting infrastructure. The only shared-kernel ids are
`UserId`/`OrgId`.

## Conventions

- **Ids**: UUIDv7 primary keys (`id`), time-ordered and index-friendly. Slugs
  are separate, URL-facing identifiers — never the primary key.
- **Timestamps**: `timestamptz` (UTC), millisecond precision.
- **Soft delete**: `deleted_at timestamptz NULL` on user-visible resources
  (`orgs`, `folders`, `reports`). Hard purge is a scheduled job after the appeal
  window. Queries filter `deleted_at IS NULL`.
- **Tenant isolation**: every owned-row query filters by `org_id`, enforced in
  the repositories (ADR-020). A custom ESLint rule flags a raw select on a
  tenant table without an `org_id` predicate.
- **JSONB**: only for shapes never queried individually (`manifest_json`,
  `plan_limits_json`, `scopes`, `findings`, `meta_json`, `allowed_emails`,
  `csp_extras`). Anything we filter or aggregate on gets a real column.
- **Foreign keys**: `ON DELETE RESTRICT` by default; `ON DELETE CASCADE` only on
  `report_versions → reports`, `acls → reports`, and
  `scan_jobs → report_versions`. The app soft-deletes; cascades defend against
  accidental hard-deletes via migrations (and keep the
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
| `grant_level` | `editor`, `admin` |
| `scan_status` | `pending`, `clean`, `flagged`, `blocked` |
| `scan_job_status` | `queued`, `running`, `done`, `failed` |
| `acl_mode` | `public`, `password`, `org`, `allowlist` |
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
| `plan` | `plan` | default `free` |
| `plan_limits_json` | jsonb | quota ceilings (`PlanLimits`, ADR-006) |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz NULL | soft delete |

Indexes: `clerk_org_id` unique, `plan`.

#### `users` — mirror of Clerk
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | UUIDv7 |
| `clerk_user_id` | text | unique |
| `email` | text | denormalized for pre-signup grant resolution |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `clerk_user_id` unique, `email`.

#### `api_keys`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `acting_user_id` | uuid FK → users | **user-scoped** so cross-org collaboration works |
| `issued_in_org_id` | uuid FK → orgs | org the key was minted in |
| `name` | text | |
| `scopes` | jsonb | OAuth-style scope set |
| `key_prefix` | varchar(12) | plaintext, shown in UI |
| `key_hash` | text | argon2id |
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

Indexes: `org_id`, `(org_id, parent_id, slug)` unique, and `(org_id, slug) WHERE parent_id IS NULL` unique (one Root folder per slug per org — the base index can't dedupe `parent_id = NULL` rows, ADR-0048).

#### `folder_collaborators` — grants (Phase 2.5)
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
| `org_id` | uuid FK → orgs | |
| `folder_id` | uuid FK → folders | placement at create (ADR-0037) |
| `slug` | varchar(10) | immutable `nanoid(10)`; the public URL + capability (ADR-0038) |
| `title` | text | |
| `live_version_id` | uuid FK → report_versions NULL | the served version; flips on scan-clean (monotonic, ADR-0037 §8) |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz NULL | takedown → soft delete |

Indexes: `slug` unique, `(org_id, folder_id)`, `deleted_at` partial.
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

Indexes: `report_id`, `(report_id, version_no)` unique, `scan_status`.

> **Rev-8 change:** `scan_findings` and `scanned_at` are **removed** from this
> table — the detailed findings now live on `scan_jobs`, and `scan_status` is
> just the cached verdict. Phase 1's migration creates this table without those
> two columns.

#### `acls` — one row per report
| Column | Type | Notes |
|---|---|---|
| `report_id` | uuid PK / FK → reports **ON DELETE CASCADE** | 1:1 with reports |
| `mode` | `acl_mode` | default `public` (the only Phase-1 mode) |
| `password_hash` | text NULL | argon2id, password mode |
| `allowed_emails` | jsonb NULL | allowlist mode |
| `csp_extras` | jsonb NULL | paid-plan per-report CSP opt-in |
| `updated_at` | timestamptz | |

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
retention; cold-export at month-roll. Every mutating action writes a row.

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

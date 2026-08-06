// Drizzle schema — the source for migrations, generated from docs/db-design.md
// (the contract). Grouped by bounded context (ADR-0036). Ids are UUIDv7 set
// app-side (no DB default). Column names are explicit snake_case. FK policy:
// ON DELETE RESTRICT by default; CASCADE only on report_versions→reports,
// acls→reports, report_grants→reports, report_write_grants→reports,
// scan_jobs→report_versions, comments→reports, and comments→comments (self,
// parent_comment_id — JUDGMENT CALL, ADR-0064: a thread's replies are owned by
// its root the same way versions are owned by their report, so deleting the
// root cascades its replies rather than leaving them FK-orphaned under the
// RESTRICT default) (db-design.md → Conventions).

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────
export const planEnum = pgEnum("plan", ["free", "pro"]);
export const grantLevelEnum = pgEnum("grant_level", ["editor", "admin"]);
export const scanStatusEnum = pgEnum("scan_status", ["pending", "clean", "flagged", "blocked"]);
export const versionOriginEnum = pgEnum("version_origin", ["upload", "editor"]);
export const scanJobStatusEnum = pgEnum("scan_job_status", ["queued", "running", "done", "failed"]);
export const aclModeEnum = pgEnum("acl_mode", [
  "private",
  "public",
  "password",
  "org",
  "allowlist",
]);
export const idempotencyStateEnum = pgEnum("idempotency_state", ["in_flight", "completed"]);
export const abuseStatusEnum = pgEnum("abuse_status", ["open", "actioned", "dismissed"]);
export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "delivered", "failed"]);
// New enum, added in the same migration as the column that uses it — safe (the
// drizzle-kit ADD VALUE one-transaction gotcha, #127, only bites an ADD VALUE
// on an EXISTING enum; a brand-new enum type has precedent in migration 0009,
// which added the `acl_mode` `private` value the same transaction-safe way).
export const orgKindEnum = pgEnum("org_kind", ["personal", "team"]);
// Comment intent (ADR-0064 Decision 8): what the author wants done with a comment.
export const commentIntentEnum = pgEnum("comment_intent", ["note", "enhancement", "add", "remove"]);
// Folder visibility (ADR-0076): who may see a folder — `private` (its owner +
// folder-share grantees) or `org` (every org member). A brand-new enum type,
// so the #127 drizzle-kit ADD-VALUE one-transaction gotcha does not apply
// (same precedent as org_kind, migration 0014).
export const folderVisibilityEnum = pgEnum("folder_visibility", ["private", "org"]);
// Editability (ADR-0080): the editor's own open-time verdict on a version's
// stored bytes, recorded at write time. `unsplittable` = no usable <body>
// boundary (splitShell); `unparsable` = the body defeats the reportSchema
// parser (parseBody). UNKNOWN is the column's NULL, never a value here — a
// version nobody probed must not be readable as a verdict. Brand-new enum type
// created in the same migration as its column, so the #127 drizzle-kit
// ADD-VALUE one-transaction gotcha does not apply (precedent: org_kind 0014,
// folder_visibility 0019).
export const versionEditabilityEnum = pgEnum("version_editability", [
  "editable",
  "unsplittable",
  "unparsable",
]);

// timestamptz at millisecond precision (db-design.md → Conventions).
const tstz = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () => tstz("updated_at").notNull().defaultNow();
const deletedAt = () => tstz("deleted_at");

// ── Identity & Access ──────────────────────────────────────────────────────
export const orgs = pgTable(
  "orgs",
  {
    id: uuid("id").primaryKey(),
    clerkOrgId: text("clerk_org_id").notNull(),
    name: text("name").notNull(),
    plan: planEnum("plan").notNull().default("free"),
    planLimitsJson: jsonb("plan_limits_json").notNull(),
    // ADR-0061/0068: `personal` (1:1, JIT, never gains members) vs `team`
    // (corporate-domain, multi-member by design). Default `personal` makes the
    // migration backfill-free and behavior-neutral for every existing org.
    kind: orgKindEnum("kind").notNull().default("personal"),
    // ADR-0074: the app-owned team-org join key — the lowercased email domain
    // (e.g. "housenumbers.io") for `team` orgs; NULL for personal orgs and for
    // team rows mirrored before this column existed (healed set-if-null on
    // first touch). Clerk's organization-domains feature is 402-gated on the
    // free plan, so THIS column (with the partial unique index below) is the
    // one-domain-one-org invariant, not Clerk.
    domain: text("domain"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("orgs_clerk_org_id_uniq").on(t.clerkOrgId),
    index("orgs_plan_idx").on(t.plan),
    index("orgs_kind_idx").on(t.kind),
    // One org per domain (ADR-0074) — partial so the many NULLs (personal orgs,
    // unhealed pre-migration rows) never collide. This index is what closes the
    // concurrent same-domain-first-sign-up race: the losing insert gets a 23505
    // and re-reads + joins the winner.
    uniqueIndex("orgs_domain_uniq").on(t.domain).where(sql`${t.domain} is not null`),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    // Human display name mirrored from Clerk at JIT provisioning (ADR-0063 author
    // display) — fullName / firstName lastName / username, whichever exists, else
    // null. Nullable + best-effort: author surfaces fall back to email when absent.
    displayName: text("display_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("users_clerk_user_id_uniq").on(t.clerkUserId),
    index("users_email_idx").on(t.email),
    // Partial: only soft-deleted rows (purge job lookup), mirrors reports (ADR-0054).
    index("users_deleted_at_idx").on(t.deletedAt).where(sql`${t.deletedAt} is not null`),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey(),
    actingUserId: uuid("acting_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    issuedInOrgId: uuid("issued_in_org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    scopes: jsonb("scopes").notNull(),
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: tstz("last_used_at"),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("api_keys_key_prefix_idx").on(t.keyPrefix),
    index("api_keys_acting_user_id_idx").on(t.actingUserId),
    index("api_keys_last_used_at_idx").on(t.lastUsedAt),
  ],
);

// ── Reports & Folders ────────────────────────────────────────────────────
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, { onDelete: "restrict" }),
    // Creator-owned folders (ADR-0076, reverses ADR-0059 §5). NULL = legacy
    // (pre-ADR-0076) — such folders stay visible + writable to the whole org.
    // Migration 0019 adds the column and leaves it NULL on every pre-existing
    // row (only `visibility` is backfilled, to 'org') — legacy semantics ARE
    // the behavior we're preserving, so there is nothing to backfill here.
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
    // Who may see the folder (ADR-0076). Migration 0019 backfills existing
    // rows to 'org' (no surprise disappearances), then sets the column
    // default to 'private' as the fail-safe for any raw insert; app code
    // always writes an explicit value (new folders: private, or the parent's
    // visibility; Root: always 'org' — enforced in code, root must stay
    // usable by every member for default uploads).
    visibility: folderVisibilityEnum("visibility").notNull().default("private"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("folders_org_id_idx").on(t.orgId),
    index("folders_owner_id_idx").on(t.ownerId),
    // Serves the cursor-paginated folder list (searchByOrg, ADR-0053): keyset on
    // (org_id, id DESC) over live folders.
    index("folders_org_id_keyset_idx").on(t.orgId, t.id.desc()).where(sql`${t.deletedAt} is null`),
    // Sibling-slug uniqueness applies to LIVE folders only — a soft-deleted folder
    // must not keep its slug slot, else recreating a same-named folder in the same
    // parent fails with a misleading 23505 (ADR-0036, soft-delete = deleted_at IS NULL).
    uniqueIndex("folders_org_parent_slug_uniq")
      .on(t.orgId, t.parentId, t.slug)
      .where(sql`${t.deletedAt} is null`),
    // Guarantees one top-level (Root) folder per slug per Org: the NULLs-distinct
    // base index above can't dedupe parent_id = NULL rows, so identity
    // provisioning could otherwise create ghost Root folders (ADR-0048).
    uniqueIndex("folders_org_root_slug_uniq")
      .on(t.orgId, t.slug)
      .where(sql`${t.parentId} is null and ${t.deletedAt} is null`),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "restrict" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    // The creator is the owner, in every org type (ADR-0059) — a permission
    // concept, not a tenancy change (org_id stays the tenancy/quota/listing
    // scope). Migration 0010 backfills this from report_versions.uploaded_by_user
    // at version_no = 1, then sets NOT NULL.
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 10 }).notNull(),
    title: text("title").notNull(),
    // Nullable + set after the first version commits — breaks the
    // reports ↔ report_versions cycle (db-design.md). Explicit RESTRICT to
    // match the stated FK policy (NO ACTION ≈ RESTRICT, but be explicit).
    liveVersionId: uuid("live_version_id").references((): AnyPgColumn => reportVersions.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("reports_slug_uniq").on(t.slug),
    index("reports_org_folder_idx").on(t.orgId, t.folderId),
    index("reports_owner_id_idx").on(t.ownerId),
    // Serves the cursor-paginated org-wide listing/search (searchByOrg, ADR-0053):
    // keyset on (org_id, id DESC) over live reports — id < cursor ORDER BY id DESC
    // stays O(page). Supersedes the updated_at ordering for search.
    index("reports_org_id_keyset_idx").on(t.orgId, t.id.desc()).where(sql`${t.deletedAt} is null`),
    // Retained: still serves any updated_at-ordered access (audit / recents).
    index("reports_org_updated_idx")
      .on(t.orgId, t.updatedAt.desc())
      .where(sql`${t.deletedAt} is null`),
    // Partial: only soft-deleted rows (purge job lookup), per db-design.md.
    index("reports_deleted_at_idx").on(t.deletedAt).where(sql`${t.deletedAt} is not null`),
  ],
);

export const reportVersions = pgTable(
  "report_versions",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    manifestJson: jsonb("manifest_json").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentHash: text("content_hash").notNull(),
    uploadedByUser: uuid("uploaded_by_user")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scanStatus: scanStatusEnum("scan_status").notNull().default("pending"),
    uploadedAt: tstz("uploaded_at").notNull().defaultNow(),
    // How this version was produced (ADR-0062 §6, surfaced by ADR-0065). Every row
    // is 'upload' today — the in-app editor doesn't exist yet (slice 3 writes 'editor').
    origin: versionOriginEnum("origin").notNull().default("upload"),
    // Whether the editor can open THESE bytes (ADR-0080). Nullable with NO
    // default: NULL means "never probed", which is every row written before
    // ADR-0080 and the only honest value a migration can give them — it cannot
    // read R2. Metadata ABOUT the stored bytes; the viewer still streams them
    // verbatim (ADR-0038) whatever this says.
    editability: versionEditabilityEnum("editability"),
  },
  (t) => [
    index("report_versions_report_id_idx").on(t.reportId),
    uniqueIndex("report_versions_report_version_uniq").on(t.reportId, t.versionNo),
    index("report_versions_scan_status_idx").on(t.scanStatus),
  ],
);

export const folderCollaborators = pgTable(
  "folder_collaborators",
  {
    id: uuid("id").primaryKey(),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    granteeUserId: uuid("grantee_user_id").references(() => users.id, { onDelete: "restrict" }),
    granteeEmail: text("grantee_email").notNull(),
    permission: grantLevelEnum("permission").notNull(),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    addedAt: tstz("added_at").notNull().defaultNow(),
  },
  (t) => [
    index("folder_collaborators_folder_id_idx").on(t.folderId),
    index("folder_collaborators_grantee_email_idx").on(t.granteeEmail),
    uniqueIndex("folder_collaborators_folder_email_uniq").on(t.folderId, t.granteeEmail),
  ],
);

export const acls = pgTable("acls", {
  reportId: uuid("report_id")
    .primaryKey()
    .references(() => reports.id, { onDelete: "cascade" }),
  // The column default 'public' is legacy, unused, and must not be relied on — set_acl
  // always writes an explicit mode, and a missing acls row is loaded as `private` in code
  // (rowToAcl ⇒ DEFAULT_ACL). App-enforced private-by-default wins over this column default.
  // We deliberately do NOT `SET DEFAULT 'private'` here: that would force ADD-VALUE-then-use
  // the new enum value in one migration transaction, which Postgres rejects (#127).
  mode: aclModeEnum("mode").notNull().default("public"),
  passwordHash: text("password_hash"),
  allowedEmails: jsonb("allowed_emails"),
  // Owner-set access duration for `allowlist` grants (ADR-0056); null for other modes.
  accessTtlSeconds: integer("access_ttl_seconds"),
  cspExtras: jsonb("csp_extras"),
  updatedAt: updatedAt(),
});

// Durable, revocable access grants for `allowlist` mode (ADR-0056, revocation-C).
// One row per (report, allowlisted email), created on magic-link redeem. The viewer
// checks a live grant per request; removing an email / switching mode deletes the
// grant → immediate revocation. Distinct from the stateless ~15-min password token.
export const reportGrants = pgTable(
  "report_grants",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    grantedAt: tstz("granted_at").notNull().defaultNow(),
    expiresAt: tstz("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.email] }),
    index("report_grants_expires_at_idx").on(t.expiresAt), // purge job
  ],
);

// Per-report write grants (ADR-0060) — the owner explicitly grants rename /
// re-upload / move to a specific person by email; supersedes the never-built
// folder_collaborators design. One row per (report, grantee email); no expiry
// (persists until revoked), no permission level (one implicit level). Works
// cross-org — the grantee is typically outside the report's org, so this
// table carries no org_id. grantee_user_id is resolved lazily: set
// opportunistically at grant time when the user already exists, else matched
// by normalized email at check time (see WriteGrantStore.findFor).
export const reportWriteGrants = pgTable(
  "report_write_grants",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    granteeEmail: text("grantee_email").notNull(),
    granteeUserId: uuid("grantee_user_id").references(() => users.id, { onDelete: "restrict" }),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedAt: tstz("granted_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.granteeEmail] }),
    // Unused by today's queries (all filter by report_id, the PK prefix) —
    // reserved for the signup-time grantee_user_id backfill sweep (ADR-0060 §2,
    // "grants for this email" lookup). Don't drop as dead.
    index("report_write_grants_grantee_email_idx").on(t.granteeEmail),
  ],
);

// Org-wide write on a report (ADR-0078) — the "Org write grant". The third leg
// of the `canWrite` seam (owner OR personal write grant OR this), layered onto
// the seam ADR-0060 left open ("folder-level can layer on the same seam
// later") rather than into the `Acl`, which is READ authorization and must stay
// so. Confers exactly what a personal write grant confers — rename, re-upload,
// move — and never delete or set_acl, which stay owner-only (ADR-0059 §2).
//
// ONE ROW PER REPORT: the PK is `report_id` alone, because a report belongs to
// exactly one org. That is the whole difference from `report_write_grants`,
// which is keyed by (report, grantee email) because a report may have many
// named grantees.
//
// `org_id` is STORED rather than joined from `reports`: the canWrite leg MUST
// verify the org match (an org write grant is meaningless outside the org it
// names, and honoring it cross-org would be a straight privilege escalation —
// the deliberate asymmetry with personal grants, which ARE cross-org by design,
// ADR-0060 §4). Storing it makes the check one indexed lookup and records WHICH
// org the grant was issued for, so a stale row fails the match rather than
// silently widening. RESTRICT on orgs/users, CASCADE from reports — a deleted
// report must not strand its grant.
export const reportOrgWriteGrants = pgTable("report_org_write_grants", {
  reportId: uuid("report_id")
    .primaryKey()
    .references(() => reports.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "restrict" }),
  grantedBy: uuid("granted_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  grantedAt: tstz("granted_at").notNull().defaultNow(),
});

// Per-folder visibility shares (ADR-0076) — the folder's owner grants another
// person VISIBILITY of a private folder (never write; folder writes stay
// owner-or-org per ADR-0076). Mirrors report_write_grants' shape exactly:
// email-keyed PK, lazily-resolved grantee_user_id, no expiry, no level.
// Deliberately NOT the ADR-009 `folder_collaborators` corpse above — that
// superseded table carries different semantics (inherited WRITE grants) and
// still awaits its cleanup migration (ADR-0060 trade-offs); reusing it would
// resurrect a superseded design.
export const folderShares = pgTable(
  "folder_shares",
  {
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
    granteeEmail: text("grantee_email").notNull(),
    granteeUserId: uuid("grantee_user_id").references(() => users.id, { onDelete: "restrict" }),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedAt: tstz("granted_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.folderId, t.granteeEmail] }),
    // Mirrors report_write_grants_grantee_email_idx: reserved for a
    // signup-time grantee_user_id backfill sweep ("shares for this email").
    index("folder_shares_grantee_email_idx").on(t.granteeEmail),
  ],
);

// ── Authoring & Collaboration (ADR-0064) ──────────────────────────────────
// The `Comment` aggregate: a thread is a root comment (parent_comment_id NULL)
// plus its replies, single level (enforced at the application layer, ADR-0064
// Decision 2 — not a self-join depth constraint). `anchor_json` carries the
// Anchor value object (version-pinned fallback + an optional opaque relative
// position, packages/domain/src/anchor.ts).
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // NULL = root (starts a Thread); set = a reply to that root. Self-FK CASCADE
    // (see the file-header FK-policy note) — deleting a root deletes its replies.
    parentCommentId: uuid("parent_comment_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    body: text("body").notNull(),
    // What the author wants done with the comment (ADR-0064 Decision 8). A
    // pre-existing comment (backfilled by the migration) reads as `note`.
    intent: commentIntentEnum("intent").notNull().default("note"),
    anchorJson: jsonb("anchor_json").notNull(),
    // When the comment was last edited (ADR-0064 §3), or NULL if never edited. A
    // pre-existing (backfilled) comment reads as NULL. Doubles as the
    // optimistic-concurrency token the edit use case checks.
    editedAt: tstz("edited_at"),
    resolvedAt: tstz("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("comments_report_id_idx").on(t.reportId),
    // Serves the cursor-paginated per-report comment list (listComments,
    // ADR-0053): keyset on (report_id, id DESC) — same shape as
    // report_versions_report_id_idx's sibling would be, had one been needed.
    index("comments_report_id_keyset_idx").on(t.reportId, t.id.desc()),
    index("comments_parent_comment_id_idx").on(t.parentCommentId),
  ],
);

// ── Abuse & Moderation ──────────────────────────────────────────────────────
export const scanJobs = pgTable(
  "scan_jobs",
  {
    id: uuid("id").primaryKey(),
    reportVersionId: uuid("report_version_id")
      .notNull()
      .references(() => reportVersions.id, { onDelete: "cascade" }),
    status: scanJobStatusEnum("status").notNull().default("queued"),
    verdict: scanStatusEnum("verdict"),
    findings: jsonb("findings"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("scan_jobs_report_version_uniq").on(t.reportVersionId),
    index("scan_jobs_status_idx").on(t.status),
  ],
);

export const abuseReports = pgTable(
  "abuse_reports",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "restrict" }),
    reporterIpHash: text("reporter_ip_hash").notNull(),
    reason: text("reason").notNull(),
    notes: text("notes"),
    status: abuseStatusEnum("status").notNull().default("open"),
    createdAt: createdAt(),
    actionedBy: uuid("actioned_by").references(() => users.id, { onDelete: "restrict" }),
    actionedAt: tstz("actioned_at"),
  },
  (t) => [
    index("abuse_reports_report_id_idx").on(t.reportId),
    index("abuse_reports_status_idx").on(t.status),
    index("abuse_reports_created_at_idx").on(t.createdAt),
  ],
);

export const cspReports = pgTable(
  "csp_reports",
  {
    id: uuid("id").primaryKey(),
    reportSlug: text("report_slug").notNull(),
    documentUri: text("document_uri").notNull(),
    violatedDirective: text("violated_directive").notNull(),
    blockedUri: text("blocked_uri").notNull(),
    sourceFile: text("source_file"),
    lineNo: integer("line_no"),
    raw: jsonb("raw").notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
  },
  (t) => [
    index("csp_reports_violated_directive_idx").on(t.violatedDirective),
    index("csp_reports_received_at_idx").on(t.receivedAt),
  ],
);

// ── Cross-cutting infrastructure ─────────────────────────────────────────────
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    actingUserId: uuid("acting_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    state: idempotencyStateEnum("state").notNull().default("in_flight"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.actingUserId, t.route, t.key] }),
    index("idempotency_keys_created_at_idx").on(t.createdAt),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey(),
    eventType: text("event_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: tstz("available_at").notNull().defaultNow(),
    createdAt: createdAt(),
    deliveredAt: tstz("delivered_at"),
  },
  (t) => [
    index("outbox_status_available_at_idx").on(t.status, t.availableAt),
    index("outbox_aggregate_id_idx").on(t.aggregateId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metaJson: jsonb("meta_json").notNull(),
    ipHash: text("ip_hash"),
    geo: text("geo"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_org_at_idx").on(t.orgId, t.at),
    index("audit_log_actor_user_id_idx").on(t.actorUserId),
  ],
);

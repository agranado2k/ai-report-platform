// Drizzle schema — the source for migrations, generated from docs/db-design.md
// (the contract). Grouped by bounded context (ADR-0036). Ids are UUIDv7 set
// app-side (no DB default). Column names are explicit snake_case. FK policy:
// ON DELETE RESTRICT by default; CASCADE only on report_versions→reports,
// acls→reports, scan_jobs→report_versions (db-design.md → Conventions).

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
} from 'drizzle-orm/pg-core';

// ── Enums ────────────────────────────────────────────────────────────────
export const planEnum = pgEnum('plan', ['free', 'pro']);
export const grantLevelEnum = pgEnum('grant_level', ['editor', 'admin']);
export const scanStatusEnum = pgEnum('scan_status', ['pending', 'clean', 'flagged', 'blocked']);
export const scanJobStatusEnum = pgEnum('scan_job_status', ['queued', 'running', 'done', 'failed']);
export const aclModeEnum = pgEnum('acl_mode', ['public', 'password', 'org', 'allowlist']);
export const idempotencyStateEnum = pgEnum('idempotency_state', ['in_flight', 'completed']);
export const abuseStatusEnum = pgEnum('abuse_status', ['open', 'actioned', 'dismissed']);
export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'delivered', 'failed']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

// ── Identity & Access ──────────────────────────────────────────────────────
export const orgs = pgTable(
  'orgs',
  {
    id: uuid('id').primaryKey(),
    clerkOrgId: text('clerk_org_id').notNull(),
    name: text('name').notNull(),
    plan: planEnum('plan').notNull().default('free'),
    planLimitsJson: jsonb('plan_limits_json').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('orgs_clerk_org_id_uniq').on(t.clerkOrgId), index('orgs_plan_idx').on(t.plan)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    clerkUserId: text('clerk_user_id').notNull(),
    email: text('email').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_clerk_user_id_uniq').on(t.clerkUserId), index('users_email_idx').on(t.email)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey(),
    actingUserId: uuid('acting_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    issuedInOrgId: uuid('issued_in_org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    scopes: jsonb('scopes').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('api_keys_key_prefix_idx').on(t.keyPrefix),
    index('api_keys_acting_user_id_idx').on(t.actingUserId),
    index('api_keys_last_used_at_idx').on(t.lastUsedAt),
  ],
);

// ── Reports & Folders ────────────────────────────────────────────────────
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'restrict' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('folders_org_id_idx').on(t.orgId),
    uniqueIndex('folders_org_parent_slug_uniq').on(t.orgId, t.parentId, t.slug),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'restrict' }),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    // Nullable + set after the first version commits — breaks the
    // reports ↔ report_versions cycle (db-design.md).
    liveVersionId: uuid('live_version_id').references((): AnyPgColumn => reportVersions.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('reports_slug_uniq').on(t.slug),
    index('reports_org_folder_idx').on(t.orgId, t.folderId),
    index('reports_deleted_at_idx').on(t.deletedAt),
  ],
);

export const reportVersions = pgTable(
  'report_versions',
  {
    id: uuid('id').primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    manifestJson: jsonb('manifest_json').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentHash: text('content_hash').notNull(),
    uploadedByUser: uuid('uploaded_by_user')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    scanStatus: scanStatusEnum('scan_status').notNull().default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('report_versions_report_id_idx').on(t.reportId),
    uniqueIndex('report_versions_report_version_uniq').on(t.reportId, t.versionNo),
    index('report_versions_scan_status_idx').on(t.scanStatus),
  ],
);

export const folderCollaborators = pgTable(
  'folder_collaborators',
  {
    id: uuid('id').primaryKey(),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'restrict' }),
    granteeUserId: uuid('grantee_user_id').references(() => users.id, { onDelete: 'restrict' }),
    granteeEmail: text('grantee_email').notNull(),
    permission: grantLevelEnum('permission').notNull(),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('folder_collaborators_folder_id_idx').on(t.folderId),
    index('folder_collaborators_grantee_email_idx').on(t.granteeEmail),
    uniqueIndex('folder_collaborators_folder_email_uniq').on(t.folderId, t.granteeEmail),
  ],
);

export const acls = pgTable('acls', {
  reportId: uuid('report_id')
    .primaryKey()
    .references(() => reports.id, { onDelete: 'cascade' }),
  mode: aclModeEnum('mode').notNull().default('public'),
  passwordHash: text('password_hash'),
  allowedEmails: jsonb('allowed_emails'),
  cspExtras: jsonb('csp_extras'),
  updatedAt: updatedAt(),
});

// ── Abuse & Moderation ──────────────────────────────────────────────────────
export const scanJobs = pgTable(
  'scan_jobs',
  {
    id: uuid('id').primaryKey(),
    reportVersionId: uuid('report_version_id')
      .notNull()
      .references(() => reportVersions.id, { onDelete: 'cascade' }),
    status: scanJobStatusEnum('status').notNull().default('queued'),
    verdict: scanStatusEnum('verdict'),
    findings: jsonb('findings'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('scan_jobs_report_version_uniq').on(t.reportVersionId),
    index('scan_jobs_status_idx').on(t.status),
  ],
);

export const abuseReports = pgTable(
  'abuse_reports',
  {
    id: uuid('id').primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'restrict' }),
    reporterIpHash: text('reporter_ip_hash').notNull(),
    reason: text('reason').notNull(),
    notes: text('notes'),
    status: abuseStatusEnum('status').notNull().default('open'),
    createdAt: createdAt(),
    actionedBy: uuid('actioned_by').references(() => users.id, { onDelete: 'restrict' }),
    actionedAt: timestamp('actioned_at', { withTimezone: true }),
  },
  (t) => [
    index('abuse_reports_report_id_idx').on(t.reportId),
    index('abuse_reports_status_idx').on(t.status),
    index('abuse_reports_created_at_idx').on(t.createdAt),
  ],
);

export const cspReports = pgTable(
  'csp_reports',
  {
    id: uuid('id').primaryKey(),
    reportSlug: text('report_slug').notNull(),
    documentUri: text('document_uri').notNull(),
    violatedDirective: text('violated_directive').notNull(),
    blockedUri: text('blocked_uri').notNull(),
    sourceFile: text('source_file'),
    lineNo: integer('line_no'),
    raw: jsonb('raw').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('csp_reports_violated_directive_idx').on(t.violatedDirective),
    index('csp_reports_received_at_idx').on(t.receivedAt),
  ],
);

// ── Cross-cutting infrastructure ─────────────────────────────────────────────
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    actingUserId: uuid('acting_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    route: text('route').notNull(),
    key: text('key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    state: idempotencyStateEnum('state').notNull().default('in_flight'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.actingUserId, t.route, t.key] }),
    index('idempotency_keys_created_at_idx').on(t.createdAt),
  ],
);

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    eventType: text('event_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    index('outbox_status_available_at_idx').on(t.status, t.availableAt),
    index('outbox_aggregate_id_idx').on(t.aggregateId),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metaJson: jsonb('meta_json').notNull(),
    ipHash: text('ip_hash'),
    geo: text('geo'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_org_at_idx').on(t.orgId, t.at), index('audit_log_actor_user_id_idx').on(t.actorUserId)],
);

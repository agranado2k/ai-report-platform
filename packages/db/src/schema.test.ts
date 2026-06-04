import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

describe('db schema', () => {
  it('defines the 14 tables with their snake_case names', () => {
    const names = [
      schema.orgs,
      schema.users,
      schema.apiKeys,
      schema.folders,
      schema.folderCollaborators,
      schema.reports,
      schema.reportVersions,
      schema.acls,
      schema.scanJobs,
      schema.abuseReports,
      schema.cspReports,
      schema.idempotencyKeys,
      schema.outbox,
      schema.auditLog,
    ].map(getTableName);

    expect(names).toEqual([
      'orgs',
      'users',
      'api_keys',
      'folders',
      'folder_collaborators',
      'reports',
      'report_versions',
      'acls',
      'scan_jobs',
      'abuse_reports',
      'csp_reports',
      'idempotency_keys',
      'outbox',
      'audit_log',
    ]);
  });

  it('carries every enum value set (db-design.md)', () => {
    expect(schema.planEnum.enumValues).toEqual(['free', 'pro']);
    expect(schema.grantLevelEnum.enumValues).toEqual(['editor', 'admin']);
    expect(schema.scanStatusEnum.enumValues).toEqual(['pending', 'clean', 'flagged', 'blocked']);
    expect(schema.scanJobStatusEnum.enumValues).toEqual(['queued', 'running', 'done', 'failed']);
    expect(schema.aclModeEnum.enumValues).toEqual(['public', 'password', 'org', 'allowlist']);
    expect(schema.idempotencyStateEnum.enumValues).toEqual(['in_flight', 'completed']);
    expect(schema.abuseStatusEnum.enumValues).toEqual(['open', 'actioned', 'dismissed']);
    expect(schema.outboxStatusEnum.enumValues).toEqual(['pending', 'delivered', 'failed']);
  });

  it('maps domain columns to snake_case', () => {
    expect(schema.reportVersions.reportId.name).toBe('report_id');
    expect(schema.reportVersions.versionNo.name).toBe('version_no');
    expect(schema.reports.liveVersionId.name).toBe('live_version_id');
    expect(schema.apiKeys.actingUserId.name).toBe('acting_user_id');
  });

  it('keeps the cycle-breaking + grant columns nullable, and required FKs NOT NULL', () => {
    expect(schema.reports.liveVersionId.notNull).toBe(false);
    expect(schema.folders.parentId.notNull).toBe(false);
    expect(schema.folderCollaborators.granteeUserId.notNull).toBe(false);
    expect(schema.reportVersions.reportId.notNull).toBe(true);
    expect(schema.folders.orgId.notNull).toBe(true);
  });

  it('applies ON DELETE CASCADE only on the three documented FKs', () => {
    const onDeleteFor = (table: Parameters<typeof getTableConfig>[0], localCol: string) =>
      getTableConfig(table).foreignKeys.find((fk) =>
        fk.reference().columns.some((c) => c.name === localCol),
      )?.onDelete;

    expect(onDeleteFor(schema.reportVersions, 'report_id')).toBe('cascade');
    expect(onDeleteFor(schema.acls, 'report_id')).toBe('cascade');
    expect(onDeleteFor(schema.scanJobs, 'report_version_id')).toBe('cascade');
    // A representative RESTRICT FK.
    expect(onDeleteFor(schema.apiKeys, 'acting_user_id')).toBe('restrict');
  });

  it('uses a composite primary key on idempotency_keys', () => {
    const { primaryKeys } = getTableConfig(schema.idempotencyKeys);
    expect(primaryKeys).toHaveLength(1);
    expect(primaryKeys[0]?.columns.map((c) => c.name)).toEqual(['acting_user_id', 'route', 'key']);
  });
});

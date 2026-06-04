import { getTableName } from 'drizzle-orm';
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

  it('carries the canonical enum value sets (db-design.md)', () => {
    expect(schema.scanStatusEnum.enumValues).toEqual(['pending', 'clean', 'flagged', 'blocked']);
    expect(schema.aclModeEnum.enumValues).toEqual(['public', 'password', 'org', 'allowlist']);
    expect(schema.grantLevelEnum.enumValues).toEqual(['editor', 'admin']);
    expect(schema.idempotencyStateEnum.enumValues).toEqual(['in_flight', 'completed']);
  });

  it('maps domain columns to snake_case', () => {
    expect(schema.reportVersions.reportId.name).toBe('report_id');
    expect(schema.reportVersions.versionNo.name).toBe('version_no');
    expect(schema.reports.liveVersionId.name).toBe('live_version_id');
    expect(schema.apiKeys.actingUserId.name).toBe('acting_user_id');
  });
});

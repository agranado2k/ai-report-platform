import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

describe("db schema", () => {
  it("defines the 14 tables with their snake_case names", () => {
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
      "orgs",
      "users",
      "api_keys",
      "folders",
      "folder_collaborators",
      "reports",
      "report_versions",
      "acls",
      "scan_jobs",
      "abuse_reports",
      "csp_reports",
      "idempotency_keys",
      "outbox",
      "audit_log",
    ]);
  });

  it("carries every enum value set (db-design.md)", () => {
    expect(schema.planEnum.enumValues).toEqual(["free", "pro"]);
    expect(schema.grantLevelEnum.enumValues).toEqual(["editor", "admin"]);
    expect(schema.scanStatusEnum.enumValues).toEqual(["pending", "clean", "flagged", "blocked"]);
    expect(schema.scanJobStatusEnum.enumValues).toEqual(["queued", "running", "done", "failed"]);
    expect(schema.aclModeEnum.enumValues).toEqual([
      "private",
      "public",
      "password",
      "org",
      "allowlist",
    ]);
    expect(schema.idempotencyStateEnum.enumValues).toEqual(["in_flight", "completed"]);
    expect(schema.abuseStatusEnum.enumValues).toEqual(["open", "actioned", "dismissed"]);
    expect(schema.outboxStatusEnum.enumValues).toEqual(["pending", "delivered", "failed"]);
  });

  it("maps domain columns to snake_case", () => {
    expect(schema.reportVersions.reportId.name).toBe("report_id");
    expect(schema.reportVersions.versionNo.name).toBe("version_no");
    expect(schema.reports.liveVersionId.name).toBe("live_version_id");
    expect(schema.apiKeys.actingUserId.name).toBe("acting_user_id");
  });

  it("keeps the cycle-breaking + grant columns nullable, and required FKs NOT NULL", () => {
    expect(schema.reports.liveVersionId.notNull).toBe(false);
    expect(schema.folders.parentId.notNull).toBe(false);
    expect(schema.folderCollaborators.granteeUserId.notNull).toBe(false);
    expect(schema.reportVersions.reportId.notNull).toBe(true);
    expect(schema.folders.orgId.notNull).toBe(true);
  });

  it("applies ON DELETE CASCADE only on the three documented FKs", () => {
    const onDeleteFor = (table: Parameters<typeof getTableConfig>[0], localCol: string) =>
      getTableConfig(table).foreignKeys.find((fk) =>
        fk.reference().columns.some((c) => c.name === localCol),
      )?.onDelete;

    expect(onDeleteFor(schema.reportVersions, "report_id")).toBe("cascade");
    expect(onDeleteFor(schema.acls, "report_id")).toBe("cascade");
    expect(onDeleteFor(schema.scanJobs, "report_version_id")).toBe("cascade");
    // A representative RESTRICT FK.
    expect(onDeleteFor(schema.apiKeys, "acting_user_id")).toBe("restrict");
  });

  // ADR-0078: the Org write grant — one row per report (a report belongs to
  // exactly one org), mirroring the report_write_grants family's shape but
  // keyed on the report alone rather than on (report, grantee email).
  describe("report_org_write_grants (ADR-0078)", () => {
    it("is named in snake_case and keyed on report_id alone", () => {
      expect(getTableName(schema.reportOrgWriteGrants)).toBe("report_org_write_grants");
      expect(schema.reportOrgWriteGrants.reportId.primary).toBe(true);
      expect(getTableConfig(schema.reportOrgWriteGrants).primaryKeys).toHaveLength(0);
    });

    it("carries the org the grant was issued for, and the grantor", () => {
      // org_id is STORED, not merely joinable from reports: the canWrite leg
      // must verify the org match, and a stale row must fail that match rather
      // than silently widen (ADR-0078 §1).
      expect(schema.reportOrgWriteGrants.orgId.name).toBe("org_id");
      expect(schema.reportOrgWriteGrants.orgId.notNull).toBe(true);
      expect(schema.reportOrgWriteGrants.grantedBy.name).toBe("granted_by");
      expect(schema.reportOrgWriteGrants.grantedBy.notNull).toBe(true);
      expect(schema.reportOrgWriteGrants.grantedAt.notNull).toBe(true);
    });

    it("cascades from reports but RESTRICTs on orgs and users", () => {
      const fks = getTableConfig(schema.reportOrgWriteGrants).foreignKeys;
      const onDeleteFor = (localCol: string) =>
        fks.find((fk) => fk.reference().columns.some((c) => c.name === localCol))?.onDelete;
      // Deleting a report must not strand its grant; deleting an org or the
      // granting user must be refused while the grant exists.
      expect(onDeleteFor("report_id")).toBe("cascade");
      expect(onDeleteFor("org_id")).toBe("restrict");
      expect(onDeleteFor("granted_by")).toBe("restrict");
    });
  });

  it("uses a composite primary key on idempotency_keys", () => {
    const { primaryKeys } = getTableConfig(schema.idempotencyKeys);
    expect(primaryKeys).toHaveLength(1);
    expect(primaryKeys[0]?.columns.map((c) => c.name)).toEqual(["acting_user_id", "route", "key"]);
  });
});

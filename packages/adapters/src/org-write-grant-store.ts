// DrizzleOrgWriteGrantStore — org-wide write on a report (ADR-0078 §1) over
// the `report_org_write_grants` table. The third leg of the `canWrite` seam.
//
// Deliberately much thinner than DrizzleWriteGrantStore: no email, no
// lazily-resolved grantee, no dual match. A personal write grant is matched
// against a PERSON and needs all of that; this one is matched against an ORG,
// and that comparison is done in the application layer (`hasOrgWriteGrant`),
// where both the report's org and the actor's org are in hand. `find` returns
// the row and lets the caller do the match, so no store implementation can
// quietly make the org check pass.
//
// One row per report (PK `report_id`), so `grant` is an upsert and `revoke` is
// a delete-by-key — the same revoke-by-row-delete semantics as the rest of the
// grant family.
import type { OrgWriteGrant, OrgWriteGrantStore } from "arp-application";
import { reportOrgWriteGrants } from "arp-db/schema";
import {
  type AppError,
  err,
  type OrgId,
  ok,
  orgId,
  type ReportId,
  type Result,
  type UserId,
  userId,
} from "arp-domain";
import { eq } from "drizzle-orm";
import type { DbContext } from "./client";

function grantErr(op: string, e: unknown): Result<never, AppError> {
  return err({ kind: "Unexpected", message: `orgWriteGrantStore.${op}: ${String(e)}` });
}

function toDomain(row: {
  reportId: string;
  orgId: string;
  grantedBy: string;
  grantedAt: Date;
}): OrgWriteGrant {
  return {
    reportId: row.reportId as ReportId,
    orgId: orgId(row.orgId),
    grantedBy: userId(row.grantedBy),
    grantedAt: row.grantedAt.getTime(),
  };
}

export class DrizzleOrgWriteGrantStore implements OrgWriteGrantStore {
  constructor(private readonly ctx: DbContext) {}

  async grant(reportId: ReportId, org: OrgId, grantedBy: UserId): Promise<Result<void, AppError>> {
    try {
      await this.ctx
        .current()
        .insert(reportOrgWriteGrants)
        .values({ reportId, orgId: org, grantedBy })
        // Re-granting refreshes the row rather than conflicting: the
        // three-state control re-asserts a state freely, and a 23505 there
        // would surface as a 500 for an operation that changed nothing.
        .onConflictDoUpdate({
          target: reportOrgWriteGrants.reportId,
          set: { orgId: org, grantedBy, grantedAt: new Date() },
        });
      return ok(undefined);
    } catch (e) {
      return grantErr("grant", e);
    }
  }

  async revoke(reportId: ReportId): Promise<Result<void, AppError>> {
    try {
      await this.ctx
        .current()
        .delete(reportOrgWriteGrants)
        .where(eq(reportOrgWriteGrants.reportId, reportId));
      return ok(undefined);
    } catch (e) {
      return grantErr("revoke", e);
    }
  }

  async find(reportId: ReportId): Promise<Result<OrgWriteGrant | null, AppError>> {
    try {
      const [row] = await this.ctx
        .current()
        .select()
        .from(reportOrgWriteGrants)
        .where(eq(reportOrgWriteGrants.reportId, reportId))
        .limit(1);
      return ok(row ? toDomain(row) : null);
    } catch (e) {
      return grantErr("find", e);
    }
  }
}

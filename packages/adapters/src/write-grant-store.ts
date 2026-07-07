// DrizzleWriteGrantStore — per-report write grants (ADR-0060) over the
// `report_write_grants` table. Modeled on DrizzleGrantStore: grant/revoke are
// upsert / delete-by-key; unlike the allowlist GrantStore there is no expiry.
// `findFor` is the canWrite seam's per-request check — it matches BOTH by the
// resolved `grantee_user_id` (cheap, indexed via the PK's report_id) and by
// normalized email (the durable key for a grantee who signed up after being
// granted), since `grantee_user_id` is only ever resolved opportunistically
// at grant time (ADR-0060 §2 — no event-driven backfill in this iteration).
import type { WriteGrant, WriteGrantStore } from "arp-application";
import { reportWriteGrants } from "arp-db/schema";
import {
  type AppError,
  err,
  normalizeEmailAddress,
  ok,
  type ReportId,
  type Result,
  type UserId,
  userId,
} from "arp-domain";
import { and, eq, or } from "drizzle-orm";
import type { DbContext } from "./client";

function grantErr(op: string, e: unknown): Result<never, AppError> {
  return err({ kind: "Unexpected", message: `writeGrantStore.${op}: ${String(e)}` });
}

const normEmail = normalizeEmailAddress;

function toDomain(row: {
  reportId: string;
  granteeEmail: string;
  granteeUserId: string | null;
  grantedBy: string;
  grantedAt: Date;
}): WriteGrant {
  return {
    reportId: row.reportId as ReportId,
    granteeEmail: row.granteeEmail,
    granteeUserId: row.granteeUserId ? userId(row.granteeUserId) : null,
    grantedBy: userId(row.grantedBy),
    grantedAt: row.grantedAt.getTime(),
  };
}

export class DrizzleWriteGrantStore implements WriteGrantStore {
  constructor(private readonly ctx: DbContext) {}

  async grant(
    reportId: ReportId,
    email: string,
    grantedBy: UserId,
    granteeUserId: UserId | null,
  ): Promise<Result<void, AppError>> {
    try {
      const normalized = normEmail(email);
      await this.ctx
        .current()
        .insert(reportWriteGrants)
        .values({
          reportId,
          granteeEmail: normalized,
          granteeUserId,
          grantedBy,
        })
        .onConflictDoUpdate({
          target: [reportWriteGrants.reportId, reportWriteGrants.granteeEmail],
          // Refresh grantedBy/grantedAt/granteeUserId on a re-grant — a later
          // opportunistic resolution (the grantee signed up since) should stick.
          set: { grantedBy, granteeUserId, grantedAt: new Date() },
        });
      return ok(undefined);
    } catch (e) {
      return grantErr("grant", e);
    }
  }

  async revoke(reportId: ReportId, email: string): Promise<Result<void, AppError>> {
    try {
      await this.ctx
        .current()
        .delete(reportWriteGrants)
        .where(
          and(
            eq(reportWriteGrants.reportId, reportId),
            eq(reportWriteGrants.granteeEmail, normEmail(email)),
          ),
        );
      return ok(undefined);
    } catch (e) {
      return grantErr("revoke", e);
    }
  }

  async listByReport(reportId: ReportId): Promise<Result<readonly WriteGrant[], AppError>> {
    try {
      const rows = await this.ctx
        .current()
        .select()
        .from(reportWriteGrants)
        .where(eq(reportWriteGrants.reportId, reportId));
      return ok(rows.map(toDomain));
    } catch (e) {
      return grantErr("listByReport", e);
    }
  }

  async findFor(
    reportId: ReportId,
    actor: { readonly userId: UserId; readonly email?: string },
  ): Promise<Result<WriteGrant | null, AppError>> {
    try {
      const emailMatch = actor.email
        ? eq(reportWriteGrants.granteeEmail, normEmail(actor.email))
        : undefined;
      const userIdMatch = eq(reportWriteGrants.granteeUserId, actor.userId);
      const [row] = await this.ctx
        .current()
        .select()
        .from(reportWriteGrants)
        .where(
          and(
            eq(reportWriteGrants.reportId, reportId),
            emailMatch ? or(userIdMatch, emailMatch) : userIdMatch,
          ),
        )
        .limit(1);
      return ok(row ? toDomain(row) : null);
    } catch (e) {
      return grantErr("findFor", e);
    }
  }
}

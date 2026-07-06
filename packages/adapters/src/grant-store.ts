// DrizzleGrantStore — durable, revocable allowlist access grants (ADR-0056,
// revocation-C) over the `report_grants` table. Created on magic-link redeem;
// `isGranted` is the viewer's per-request check (a live, non-expired grant);
// `revoke`/`revokeAll` give immediate revocation when the owner edits the allowlist.
import type { GrantStore } from "arp-application";
import { reportGrants } from "arp-db/schema";
import {
  type AppError,
  err,
  normalizeEmailAddress,
  ok,
  type ReportId,
  type Result,
} from "arp-domain";
import { and, eq, gt, sql } from "drizzle-orm";
import type { DbContext } from "./client";

function grantErr(op: string, e: unknown): Result<never, AppError> {
  return err({ kind: "Unexpected", message: `grantStore.${op}: ${String(e)}` });
}

// The domain's ONE email normalization home (EmailAddress, ADR-0056) so a grant
// keyed "A@B.com" still matches a lowercased allowlist + check (claude-review #114
// — the drift bug that motivated consolidating this into a single Value Object).
const normEmail = normalizeEmailAddress;

export class DrizzleGrantStore implements GrantStore {
  constructor(private readonly ctx: DbContext) {}

  async grant(
    reportId: ReportId,
    email: string,
    expiresAtMs: number,
  ): Promise<Result<void, AppError>> {
    try {
      const expiresAt = new Date(expiresAtMs);
      await this.ctx
        .current()
        .insert(reportGrants)
        .values({ reportId, email: normEmail(email), expiresAt })
        .onConflictDoUpdate({
          target: [reportGrants.reportId, reportGrants.email],
          set: { expiresAt, grantedAt: new Date() },
        });
      return ok(undefined);
    } catch (e) {
      return grantErr("grant", e);
    }
  }

  async isGranted(reportId: ReportId, email: string): Promise<Result<boolean, AppError>> {
    try {
      const [row] = await this.ctx
        .current()
        .select({ one: sql`1` })
        .from(reportGrants)
        .where(
          and(
            eq(reportGrants.reportId, reportId),
            eq(reportGrants.email, normEmail(email)),
            gt(reportGrants.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return ok(Boolean(row));
    } catch (e) {
      return grantErr("isGranted", e);
    }
  }

  async revoke(reportId: ReportId, email: string): Promise<Result<void, AppError>> {
    try {
      await this.ctx
        .current()
        .delete(reportGrants)
        .where(and(eq(reportGrants.reportId, reportId), eq(reportGrants.email, normEmail(email))));
      return ok(undefined);
    } catch (e) {
      return grantErr("revoke", e);
    }
  }

  async revokeAll(reportId: ReportId): Promise<Result<void, AppError>> {
    try {
      await this.ctx.current().delete(reportGrants).where(eq(reportGrants.reportId, reportId));
      return ok(undefined);
    } catch (e) {
      return grantErr("revokeAll", e);
    }
  }
}

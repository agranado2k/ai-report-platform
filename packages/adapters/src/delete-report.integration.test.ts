// Integration test proving the deleteReport ATOMICITY guarantee (ADR-0037 §5 /
// ADR-0070) against real Postgres (pglite): deleteReport wraps softDelete +
// audit.record in ONE DrizzleUnitOfWork transaction, so when the audit write
// fails, the softDelete is rolled back too — the report row's `deleted_at`
// stays null. A stub AuditLogger (not DrizzleAuditLogger) forces the failure;
// the DrizzleReportRepository + DrizzleUnitOfWork are the real adapters.
import { type AuditEntry, type DeleteReportDeps, deleteReport } from "arp-application";
import { auditLog, reports as reportsTable } from "arp-db/schema";
import { type AppError, err, type Result } from "arp-domain";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleAuditLogger } from "./audit-logger";
import { DrizzleReportRepository } from "./report-repository";
import {
  makeSampleReport,
  makeTestDb,
  type SeededIdentity,
  seedIdentity,
  type TestDb,
} from "./testing/pglite";
import { DrizzleUnitOfWork } from "./unit-of-work";

class FailingAuditLogger {
  async record(_entries: readonly AuditEntry[]): Promise<Result<void, AppError>> {
    return err({ kind: "Unexpected", message: "audit sink down" });
  }
}

describe("deleteReport (pglite integration) — commit-last atomicity with a real UnitOfWork", () => {
  let tdb: TestDb;
  let ids: SeededIdentity;
  let reports: DrizzleReportRepository;

  beforeEach(async () => {
    tdb = await makeTestDb();
    ids = await seedIdentity(tdb.ctx);
    reports = new DrizzleReportRepository(tdb.ctx);
  });
  afterEach(() => tdb.close());

  it("rolls back the soft-delete when audit.record fails inside the same transaction", async () => {
    const { report } = makeSampleReport();
    await reports.save(report);

    const deps: DeleteReportDeps = {
      reports,
      audit: new FailingAuditLogger(),
      uow: new DrizzleUnitOfWork(tdb.ctx),
    };

    const r = await deleteReport(
      deps,
      { orgId: ids.orgId, userId: ids.userId },
      {
        slug: report.slug,
      },
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("audit sink down");

    // The mutation did NOT persist — deleted_at is still null.
    const rows = await tdb.ctx
      .current()
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, report.id));
    expect(rows[0]?.deletedAt).toBeNull();

    // No stray audit row either (the whole tx rolled back).
    const auditRows = await tdb.ctx.current().select().from(auditLog);
    expect(auditRows).toHaveLength(0);
  });

  it("commits both the soft-delete and the audit row when audit.record succeeds", async () => {
    const { report } = makeSampleReport();
    await reports.save(report);

    const deps: DeleteReportDeps = {
      reports,
      audit: new DrizzleAuditLogger(tdb.ctx),
      uow: new DrizzleUnitOfWork(tdb.ctx),
    };

    const r = await deleteReport(
      deps,
      { orgId: ids.orgId, userId: ids.userId },
      {
        slug: report.slug,
      },
    );
    expect(r.ok).toBe(true);

    const rows = await tdb.ctx
      .current()
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, report.id));
    expect(rows[0]?.deletedAt).not.toBeNull();

    const auditRows = await tdb.ctx.current().select().from(auditLog);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ action: "report.deleted", targetId: report.id });
  });
});

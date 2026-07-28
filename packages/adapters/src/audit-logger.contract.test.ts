// Runs the shared AuditLogger contract (arp-application/testing) against
// DrizzleAuditLogger on pglite (ADR-0046, ADR-0070) — the same suite that runs
// against InMemoryAuditLogger in packages/application/src/testing/contracts/
// audit-logger.contract.test.ts. The read-back seam SELECTs the adapter's own
// audit_log table (ordered by the uuidv7 id = insert order) and maps rows back
// to the port's entry shape; adapter-only columns (ipHash/geo/at) remain
// covered by audit-logger.integration.test.ts.
import type { AuditAction } from "arp-application";
import { describeAuditLoggerContract } from "arp-application/testing";
import { auditLog } from "arp-db/schema";
import { orgId, userId } from "arp-domain";
import { asc } from "drizzle-orm";
import { DrizzleAuditLogger } from "./audit-logger";
import { makeTestDb, seedIdentity } from "./testing/pglite";

describeAuditLoggerContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const ids = await seedIdentity(tdb.ctx);
  return {
    audit: new DrizzleAuditLogger(tdb.ctx),
    orgId: ids.orgId,
    actorUserId: ids.userId,
    async recorded() {
      const rows = await tdb.ctx.current().select().from(auditLog).orderBy(asc(auditLog.id));
      return rows.map((r) => ({
        action: r.action as AuditAction,
        orgId: orgId(r.orgId),
        actorUserId: r.actorUserId === null ? null : userId(r.actorUserId),
        targetType: r.targetType,
        targetId: r.targetId,
        meta: (r.metaJson ?? {}) as Readonly<Record<string, unknown>>,
      }));
    },
    teardown: () => tdb.close(),
  };
});

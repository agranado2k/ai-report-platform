// DrizzleAuditLogger — appends audit_log rows (ADR-0070, issue #153) in the
// same tx as the state change. Mirrors DrizzleEventOutbox's shape exactly.
import type { AuditEntry, AuditLogger } from "arp-application";
import { auditLog } from "arp-db/schema";
import { type AppError, ok, type Result } from "arp-domain";
import { v7 as uuidv7 } from "uuid";
import type { DbContext } from "./client";

export class DrizzleAuditLogger implements AuditLogger {
  constructor(private readonly ctx: DbContext) {}

  async record(entries: readonly AuditEntry[]): Promise<Result<void, AppError>> {
    if (entries.length === 0) return ok(undefined);
    try {
      const rows = entries.map((e) => ({
        id: uuidv7(),
        orgId: e.orgId,
        actorUserId: e.actorUserId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        metaJson: e.meta ?? {},
        ipHash: null,
        geo: null,
        // `at` defaults in the DB (defaultNow()) — deliberately not set here.
      }));
      await this.ctx.current().insert(auditLog).values(rows);
      return ok(undefined);
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: "Unexpected",
          message: `audit.record: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
  }
}

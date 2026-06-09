// DrizzleIdempotencyStore — the idempotency-keys table (ADR-0039). A claim is
// an INSERT … ON CONFLICT DO NOTHING; a conflict resolves to replay (completed
// + same fingerprint), reuse-different-body (422), or in-flight (409).
import type {
  IdempotencyBegin,
  IdempotencyKeyRef,
  IdempotencyRecord,
  IdempotencyStore,
} from "arp-application";
import { idempotencyKeys } from "arp-db/schema";
import { type AppError, ok, type Result } from "arp-domain";
import { and, eq } from "drizzle-orm";
import type { DbContext } from "./client";

export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly ctx: DbContext) {}

  private whereRef(ref: IdempotencyKeyRef) {
    return and(
      eq(idempotencyKeys.actingUserId, ref.actingUserId),
      eq(idempotencyKeys.route, ref.route),
      eq(idempotencyKeys.key, ref.key),
    );
  }

  async begin(
    ref: IdempotencyKeyRef,
    fingerprint: string,
  ): Promise<Result<IdempotencyBegin, AppError>> {
    try {
      const db = this.ctx.current();
      const inserted = await db
        .insert(idempotencyKeys)
        .values({
          actingUserId: ref.actingUserId,
          route: ref.route,
          key: ref.key,
          requestFingerprint: fingerprint,
          state: "in_flight",
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });

      if (inserted.length > 0) return ok({ outcome: "proceed" });

      const [row] = await db.select().from(idempotencyKeys).where(this.whereRef(ref)).limit(1);
      if (!row) return ok({ outcome: "in_flight" }); // raced + vanished; be conservative
      if (row.requestFingerprint !== fingerprint) {
        return {
          ok: false,
          error: {
            kind: "IdempotencyKeyReuseDifferentBody",
            message: "idempotency key reused with a different request",
          },
        };
      }
      if (row.state === "completed" && row.responseStatus !== null) {
        return ok({
          outcome: "replay",
          record: { responseStatus: row.responseStatus, responseBody: row.responseBody },
        });
      }
      return ok({ outcome: "in_flight" });
    } catch (e) {
      return thrown("idempotency.begin", e);
    }
  }

  async complete(
    ref: IdempotencyKeyRef,
    record: IdempotencyRecord,
  ): Promise<Result<void, AppError>> {
    try {
      await this.ctx
        .current()
        .update(idempotencyKeys)
        .set({
          state: "completed",
          responseStatus: record.responseStatus,
          responseBody: record.responseBody,
        })
        .where(this.whereRef(ref));
      return ok(undefined);
    } catch (e) {
      return thrown("idempotency.complete", e);
    }
  }
}

function thrown(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `${op}: ${e instanceof Error ? e.message : String(e)}` },
  };
}

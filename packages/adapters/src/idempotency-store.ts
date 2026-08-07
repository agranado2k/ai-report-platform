// DrizzleIdempotencyStore — the idempotency-keys table (ADR-0039). A claim is
// an INSERT … ON CONFLICT DO NOTHING; a conflict resolves to replay (completed
// + same fingerprint), reuse-different-body (422), or in-flight (409).
//
// RETENTION (issue #233 finding 2 / GHSA-ghxh-82j4-pp6m). ADR-0039 describes a
// 24h window and the code was written as if one existed, but no sweep and no
// predicate enforced it: a record replayed FOREVER. That unbounded window is
// what turned the derived-key defect from a 24h annoyance into a permanent one.
// The derived-key half is fixed in `beginIdempotentWrite` (state-setting
// operations no longer derive a key at all); this is the other half, so an
// EXPLICIT key cannot replay a response from months ago either.
//
// Enforced at CLAIM time, not by a delete: expiry must not depend on a job
// having run. An expired record is RECLAIMED in place (so the key works again)
// rather than merely hidden — hiding it would answer in_flight/409 forever,
// which is worse than the staleness it fixes. Rows still accumulate; a purge
// job is a separate, purely operational follow-up, and its absence is now a
// storage cost rather than a correctness one.
import type {
  IdempotencyBegin,
  IdempotencyKeyRef,
  IdempotencyRecord,
  IdempotencyStore,
} from "arp-application";
import { idempotencyKeys } from "arp-db/schema";
import { type AppError, ok, type Result } from "arp-domain";
import { and, eq, lte, sql } from "drizzle-orm";
import type { DbContext } from "./client";

/** ADR-0039's stated window. A record older than this is treated as absent.
 *  Exported so the retention sweep uses the SAME window `begin` enforces —
 *  the route used to re-declare it and assert in a comment that they matched. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly ctx: DbContext) {}

  /** The cutoff below which a record no longer counts. */
  private freshSince(): Date {
    return new Date(Date.now() - IDEMPOTENCY_TTL_MS);
  }

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

      // EXPIRED: past the TTL, the old record must neither replay nor block.
      // Reclaim it in place — filtering it out of the SELECT instead would have
      // made every expired key answer in_flight (409) forever, which is a
      // worse failure than the one the TTL exists to fix. The UPDATE is
      // conditioned on the row still being stale, so if a concurrent request
      // reclaimed it first this affects 0 rows and we fall through to the
      // conservative in_flight below.
      if (row.createdAt <= this.freshSince()) {
        const reclaimed = await db
          .update(idempotencyKeys)
          .set({
            requestFingerprint: fingerprint,
            state: "in_flight",
            responseStatus: null,
            responseBody: null,
            createdAt: new Date(),
          })
          .where(and(this.whereRef(ref), lte(idempotencyKeys.createdAt, this.freshSince())))
          .returning({ key: idempotencyKeys.key });
        if (reclaimed.length > 0) return ok({ outcome: "proceed" });
        return ok({ outcome: "in_flight" });
      }
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

  /**
   * Retention sweep. Bounded by `limit` so a tick stays well inside the
   * caller's timeout, and safe to run concurrently — the DELETE takes row
   * locks and a row deleted by another tick simply is not returned twice.
   *
   * Deliberately NOT load-bearing: `begin` already reclaims an expired row, so
   * correctness never waits on this having run. ADR-0039 once described a
   * 24h window enforced by a sweep that did not exist, and the records
   * therefore replayed forever (issue #233) — the lesson recorded there is
   * that expiry belongs at the read, and a purge is only housekeeping.
   */
  async purgeExpired(olderThan: Date, limit: number): Promise<Result<number, AppError>> {
    try {
      const db = this.ctx.current();
      // Match the FULL primary key. `key` alone does not identify a row — the
      // PK is (acting_user_id, route, key), and an explicit client-supplied key
      // is just a string, so two users can hold the same one. Deleting by
      // `key IN (…)` would take another user's row with it, including a FRESH
      // in-flight claim, whose owner would then re-execute instead of replaying.
      const deleted = await db.execute(sql`
        DELETE FROM ${idempotencyKeys}
        WHERE (${idempotencyKeys.actingUserId}, ${idempotencyKeys.route}, ${idempotencyKeys.key})
          IN (
            SELECT ${idempotencyKeys.actingUserId}, ${idempotencyKeys.route}, ${idempotencyKeys.key}
            FROM ${idempotencyKeys}
            WHERE ${idempotencyKeys.createdAt} <= ${olderThan}
            LIMIT ${limit}
          )
        RETURNING ${idempotencyKeys.key}
      `);
      // `rowCount` is not populated by every driver (pglite leaves it 0), so
      // count what RETURNING actually gave back.
      const rows = (deleted as { readonly rows?: readonly unknown[] }).rows;
      return ok(Array.isArray(rows) ? rows.length : 0);
    } catch (e) {
      return thrown("idempotency.purgeExpired", e);
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

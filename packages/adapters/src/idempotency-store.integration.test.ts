// Integration tests for DrizzleIdempotencyStore against real Postgres (pglite).
import type { IdempotencyKeyRef } from "arp-application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DrizzleIdempotencyStore } from "./idempotency-store";
import { makeTestDb, type SeededIdentity, seedIdentity, type TestDb } from "./testing/pglite";

describe("DrizzleIdempotencyStore (pglite integration)", () => {
  let tdb: TestDb;
  let store: DrizzleIdempotencyStore;
  let ids: SeededIdentity;

  beforeEach(async () => {
    tdb = await makeTestDb();
    ids = await seedIdentity(tdb.ctx);
    store = new DrizzleIdempotencyStore(tdb.ctx);
  });
  afterEach(() => tdb.close());

  const ref = (): IdempotencyKeyRef => ({
    actingUserId: ids.userId,
    route: "POST /api/v1/reports",
    key: "key-1",
  });

  it("claims a fresh key with outcome 'proceed'", async () => {
    const r = await store.begin(ref(), "fp1");
    expect(r.ok && r.value.outcome).toBe("proceed");
  });

  it("returns 'in_flight' on a re-begin before completion", async () => {
    await store.begin(ref(), "fp1");
    const r = await store.begin(ref(), "fp1");
    expect(r.ok && r.value.outcome).toBe("in_flight");
  });

  it("replays the stored response after completion", async () => {
    await store.begin(ref(), "fp1");
    await store.complete(ref(), { responseStatus: 201, responseBody: { slug: "abcde12345" } });

    const r = await store.begin(ref(), "fp1");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.outcome === "replay") {
      expect(r.value.record.responseStatus).toBe(201);
      expect(r.value.record.responseBody).toEqual({ slug: "abcde12345" });
    } else {
      throw new Error(`expected replay, got ${r.ok ? r.value.outcome : "err"}`);
    }
  });

  it("rejects a reused key with a different fingerprint (422 reuse)", async () => {
    await store.begin(ref(), "fp1");
    const r = await store.begin(ref(), "fp2-different");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("IdempotencyKeyReuseDifferentBody");
  });

  // ── TTL + reclaim (issue #233 finding 2 / GHSA-ghxh-82j4-pp6m) ───────────
  //
  // ADR-0039 always described a 24h window; nothing enforced it, so a record
  // replayed forever — which is what made the derived-key defect permanent
  // rather than a one-day annoyance. These pin the claim-time expiry AND the
  // reclaim, because the obvious implementation (filter stale rows out of the
  // lookup) would answer in_flight/409 forever: a worse failure than the
  // staleness it fixes, and one no existing test would have caught.
  describe("expiry", () => {
    /** Backdate the stored row, the only way to cross the window in a test. */
    const ageRow = async (hours: number) => {
      await tdb.ctx
        .current()
        .execute(
          sql`UPDATE idempotency_keys SET created_at = now() - ${`${hours} hours`}::interval`,
        );
    };

    it("replays a record that is still inside the window", async () => {
      await store.begin(ref(), "fp1");
      await store.complete(ref(), { responseStatus: 200, responseBody: { v: 1 } });
      await ageRow(23);

      const r = await store.begin(ref(), "fp1");
      expect(r.ok && r.value.outcome).toBe("replay");
    });

    it("RECLAIMS an expired completed record instead of replaying it", async () => {
      await store.begin(ref(), "fp1");
      await store.complete(ref(), { responseStatus: 200, responseBody: { v: 1 } });
      await ageRow(25);

      const r = await store.begin(ref(), "fp1");
      expect(r.ok && r.value.outcome).toBe("proceed");
    });

    it("does NOT answer in_flight forever once expired — the key works again", async () => {
      // The regression the reclaim exists to prevent: hiding a stale row makes
      // the SELECT miss and every retry 409 for good.
      await store.begin(ref(), "fp1");
      await store.complete(ref(), { responseStatus: 200, responseBody: { v: 1 } });
      await ageRow(25);

      const reclaimed = await store.begin(ref(), "fp1");
      expect(reclaimed.ok && reclaimed.value.outcome).toBe("proceed");
      await store.complete(ref(), { responseStatus: 200, responseBody: { v: 2 } });

      // …and the NEW response is what replays afterwards, not the wiped one.
      const after = await store.begin(ref(), "fp1");
      expect(after.ok && after.value.outcome).toBe("replay");
      if (after.ok && after.value.outcome === "replay") {
        expect(after.value.record.responseBody).toEqual({ v: 2 });
      }
    });

    it("reclaims an expired record that was still in_flight (a crashed request)", async () => {
      await store.begin(ref(), "fp1");
      await ageRow(25);

      const r = await store.begin(ref(), "fp1");
      expect(r.ok && r.value.outcome).toBe("proceed");
    });

    it("does NOT clobber a FRESH in-flight record", async () => {
      await store.begin(ref(), "fp1");

      const r = await store.begin(ref(), "fp1");
      expect(r.ok && r.value.outcome).toBe("in_flight");
    });

    it("an expired key reused with a DIFFERENT body proceeds rather than 422ing", async () => {
      // Deliberate and worth pinning: past the window the key is genuinely
      // free, so the reuse-different-body guard no longer applies. Recorded in
      // the ADR-0039 amendment as a wire-contract change.
      await store.begin(ref(), "fp1");
      await store.complete(ref(), { responseStatus: 200, responseBody: { v: 1 } });
      await ageRow(25);

      const r = await store.begin(ref(), "fp2-different");
      expect(r.ok && r.value.outcome).toBe("proceed");
    });
  });
});

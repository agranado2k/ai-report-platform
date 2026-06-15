// Integration tests for DrizzleIdempotencyStore against real Postgres (pglite).
import type { IdempotencyKeyRef } from "arp-application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});

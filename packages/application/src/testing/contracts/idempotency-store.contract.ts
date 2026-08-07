// Shared IdempotencyStore contract (ADR-0039, ADR-0046 two-tier testing). Run
// this ONE suite against both the InMemoryIdempotencyStore fake
// (packages/application/src/testing/contracts/idempotency-store.contract.test.ts)
// and DrizzleIdempotencyStore on pglite
// (packages/adapters/src/idempotency-store.contract.test.ts).
//
// NOT part of the contract: `complete()` without a prior `begin()` — the fake
// deliberately throws there as a test tripwire, while the real adapter's
// UPDATE just matches 0 rows; use-case code never takes that path.
import type { UserId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IdempotencyKeyRef, IdempotencyStore } from "../../ports";

export interface IdempotencyStoreContractHarness {
  readonly store: IdempotencyStore;
  /** An acting user the implementation accepts refs for (the real adapter's FK). */
  readonly actingUserId: UserId;
  /** Release whatever the harness allocated; a no-op for the in-memory fake. */
  teardown(): Promise<void>;
}

/**
 * Runs the IdempotencyStore contract against `setup()`'s implementation.
 * `label` distinguishes the two runs in test output (e.g. "in-memory" vs
 * "drizzle+pglite"). `setup()` is called fresh before EVERY test.
 */
export function describeIdempotencyStoreContract(
  label: string,
  setup: () => Promise<IdempotencyStoreContractHarness>,
): void {
  describe(`IdempotencyStore contract (${label})`, () => {
    let h: IdempotencyStoreContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    const ref = (key = "key-1"): IdempotencyKeyRef => ({
      actingUserId: h.actingUserId,
      route: "POST /api/v1/reports",
      key,
    });

    // ── purgeExpired ────────────────────────────────────────────────────
    //
    // Added after a cross-tenant deletion bug reached the Drizzle adapter while
    // the in-memory fake was correct (PR #259 review). That divergence is
    // exactly what this two-tier contract (ADR-0046) exists to catch, and it
    // only escaped because `purgeExpired` was implemented in both tiers and
    // pinned in neither. Retention is housekeeping — but housekeeping that can
    // delete the wrong row is not.
    it("purges nothing when every record is inside the window", async () => {
      await h.store.begin(ref(), "fp1");

      const purged = await h.store.purgeExpired(new Date(Date.now() - 60_000), 100);

      expect(purged.ok && purged.value).toBe(0);
      expect((await h.store.begin(ref(), "fp1")).ok).toBe(true);
    });

    it("purges a record once it is outside the window", async () => {
      await h.store.begin(ref(), "fp1");
      await h.store.complete(ref(), { responseStatus: 200, responseBody: { v: 1 } });

      // Everything claimed so far is "older than" a cutoff in the future.
      const purged = await h.store.purgeExpired(new Date(Date.now() + 60_000), 100);

      expect(purged.ok && purged.value).toBe(1);
      // Gone: the key claims fresh instead of replaying.
      const after = await h.store.begin(ref(), "fp1");
      expect(after.ok && after.value.outcome).toBe("proceed");
    });

    it("honours the limit, so one sweep cannot run unbounded", async () => {
      await h.store.begin(ref("k-a"), "fp1");
      await h.store.begin(ref("k-b"), "fp1");
      await h.store.begin(ref("k-c"), "fp1");

      const purged = await h.store.purgeExpired(new Date(Date.now() + 60_000), 2);

      expect(purged.ok && purged.value).toBe(2);
    });

    it("NEVER deletes a row that merely shares the key string on another route", async () => {
      // The identity of a record is (actingUserId, route, key) — `key` alone is
      // a client-chosen string. Matching on it alone deletes other people's
      // live claims, whose owners then re-execute instead of replaying.
      const mine: IdempotencyKeyRef = { ...ref("shared"), route: "POST /api/v1/reports" };
      const other: IdempotencyKeyRef = { ...ref("shared"), route: "DELETE /api/v1/reports/{slug}" };
      await h.store.begin(mine, "fp1");
      await h.store.complete(mine, { responseStatus: 200, responseBody: { v: 1 } });

      const purged = await h.store.purgeExpired(new Date(Date.now() + 60_000), 1);

      expect(purged.ok && purged.value).toBe(1);
      // `other` was never claimed, so it must still be claimable — proving the
      // sweep did not reach across the route boundary.
      const stillFree = await h.store.begin(other, "fp1");
      expect(stillFree.ok && stillFree.value.outcome).toBe("proceed");
    });

    it("claims a fresh key with outcome 'proceed'", async () => {
      const r = await h.store.begin(ref(), "fp1");
      expect(r.ok && r.value.outcome).toBe("proceed");
    });

    it("returns 'in_flight' on a re-begin before completion (concurrent retry → 409)", async () => {
      await h.store.begin(ref(), "fp1");
      const r = await h.store.begin(ref(), "fp1");
      expect(r.ok && r.value.outcome).toBe("in_flight");
    });

    it("replays the stored response after complete() (status + body round-trip)", async () => {
      await h.store.begin(ref(), "fp1");
      await h.store.complete(ref(), { responseStatus: 201, responseBody: { slug: "abcde12345" } });

      const r = await h.store.begin(ref(), "fp1");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.outcome === "replay") {
        expect(r.value.record.responseStatus).toBe(201);
        expect(r.value.record.responseBody).toEqual({ slug: "abcde12345" });
      } else {
        throw new Error(`expected replay, got ${r.ok ? r.value.outcome : "err"}`);
      }
    });

    it("rejects a reused key with a different fingerprint (422 reuse-different-body)", async () => {
      await h.store.begin(ref(), "fp1");
      const r = await h.store.begin(ref(), "fp2-different");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("IdempotencyKeyReuseDifferentBody");
    });

    it("fingerprint mismatch applies after completion too — a completed key never replays a different body", async () => {
      await h.store.begin(ref(), "fp1");
      await h.store.complete(ref(), { responseStatus: 201, responseBody: { slug: "abcde12345" } });
      const r = await h.store.begin(ref(), "fp2-different");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("IdempotencyKeyReuseDifferentBody");
    });

    it("distinct keys are independent claims — a second key proceeds while the first is in flight", async () => {
      await h.store.begin(ref("key-1"), "fp1");
      const r = await h.store.begin(ref("key-2"), "fp1");
      expect(r.ok && r.value.outcome).toBe("proceed");
    });
  });
}

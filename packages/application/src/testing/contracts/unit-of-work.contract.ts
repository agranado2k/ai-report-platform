// Shared UnitOfWork contract (ADR-0037 §5 commit-last atomicity, ADR-0046
// two-tier testing). Run this ONE suite against both the
// TransactionalInMemoryUnitOfWork fake
// (packages/application/src/testing/contracts/unit-of-work.contract.test.ts)
// and DrizzleUnitOfWork on pglite
// (packages/adapters/src/unit-of-work.contract.test.ts). The harness owns the
// implementation-specific "observable effect" (an in-memory fake mutation vs a
// real outbox row); the contract only knows: effects inside run() commit on ok,
// and roll back on err (the adapter's Rollback-sentinel path,
// packages/adapters/src/unit-of-work.ts) or on a thrown error.
import { err, ok } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../ports";

export interface UnitOfWorkContractHarness {
  readonly uow: UnitOfWork;
  /** Perform ONE observable side effect. Only meaningful inside `uow.run`'s
   *  callback — that placement is what the contract exercises. */
  writeEffect(): Promise<unknown>;
  /** How many effects are durably visible OUTSIDE any open transaction. */
  committedCount(): Promise<number>;
  /** Release whatever the harness allocated; a no-op for the in-memory fake. */
  teardown(): Promise<void>;
}

/**
 * Runs the UnitOfWork contract against `setup()`'s implementation. `label`
 * distinguishes the two runs in test output (e.g. "in-memory" vs
 * "drizzle+pglite"). `setup()` is called fresh before EVERY test.
 */
export function describeUnitOfWorkContract(
  label: string,
  setup: () => Promise<UnitOfWorkContractHarness>,
): void {
  describe(`UnitOfWork contract (${label})`, () => {
    let h: UnitOfWorkContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("commits effects made inside run() when the work returns ok, passing the value through", async () => {
      const r = await h.uow.run(async () => {
        await h.writeEffect();
        return ok("done");
      });
      expect(r.ok && r.value).toBe("done");
      expect(await h.committedCount()).toBe(1);
    });

    it("rolls back effects and returns the err UNCHANGED when the work returns err (the Rollback sentinel path)", async () => {
      const r = await h.uow.run(async () => {
        await h.writeEffect();
        return err({ kind: "ValidationError", message: "boom" });
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toEqual({ kind: "ValidationError", message: "boom" });
      expect(await h.committedCount()).toBe(0);
    });

    it("rolls back effects and maps a THROWN error to Unexpected('unitOfWork: …')", async () => {
      const r = await h.uow.run(async () => {
        await h.writeEffect();
        throw new Error("wire snapped");
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe("Unexpected");
        expect(r.error.message).toBe("unitOfWork: wire snapped");
      }
      expect(await h.committedCount()).toBe(0);
    });

    it("a rolled-back run leaves the implementation usable — a following run commits normally", async () => {
      await h.uow.run(async () => {
        await h.writeEffect();
        return err({ kind: "ValidationError", message: "first run fails" });
      });
      const r = await h.uow.run(async () => {
        await h.writeEffect();
        return ok(undefined);
      });
      expect(r.ok).toBe(true);
      expect(await h.committedCount()).toBe(1);
    });

    it("accumulates effects across successive committed runs", async () => {
      await h.uow.run(async () => {
        await h.writeEffect();
        return ok(undefined);
      });
      await h.uow.run(async () => {
        await h.writeEffect();
        return ok(undefined);
      });
      expect(await h.committedCount()).toBe(2);
    });
  });
}

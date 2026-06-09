// DrizzleUnitOfWork — runs the commit-last callback (repo.save + outbox.enqueue
// + idempotency.complete) inside ONE Postgres transaction (ADR-0037 §5). The
// adapters share the open tx via DbContext.current(). A domain-level `err`
// result rolls the transaction back (we throw a sentinel, then return the err).
import type { UnitOfWork } from "arp-application";
import type { AppError, Result } from "arp-domain";
import type { DbContext } from "./client";

class Rollback<T> {
  constructor(readonly result: Result<T, AppError>) {}
}

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly ctx: DbContext) {}

  async run<T>(work: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    let captured: Result<T, AppError> | undefined;
    try {
      await this.ctx.run(async () => {
        const r = await work();
        captured = r;
        if (!r.ok) throw new Rollback(r); // force the tx to roll back
        return r;
      });
      // transaction committed
      return captured as Result<T, AppError>;
    } catch (e) {
      if (e instanceof Rollback) return e.result as Result<T, AppError>;
      return {
        ok: false,
        error: {
          kind: "Unexpected",
          message: `unitOfWork: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
  }
}

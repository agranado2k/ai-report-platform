// Runs the shared UnitOfWork contract (arp-application/testing) against
// DrizzleUnitOfWork on pglite (ADR-0046, ADR-0037 §5) — the same suite that
// runs against TransactionalInMemoryUnitOfWork in packages/application/src/
// testing/contracts/unit-of-work.contract.test.ts. The observable effect is a
// real outbox row written through DrizzleEventOutbox inside the transaction.
import { describeUnitOfWorkContract } from "arp-application/testing";
import { outbox } from "arp-db/schema";
import { DrizzleEventOutbox } from "./event-outbox";
import { makeTestDb, sampleReport } from "./testing/pglite";
import { DrizzleUnitOfWork } from "./unit-of-work";

describeUnitOfWorkContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  const store = new DrizzleEventOutbox(tdb.ctx);
  const [event] = sampleReport().events;
  if (!event) throw new Error("sampleReport produced no events");

  return {
    uow: new DrizzleUnitOfWork(tdb.ctx),
    writeEffect: () => store.enqueue([event]),
    committedCount: async () => (await tdb.ctx.current().select().from(outbox)).length,
    teardown: () => tdb.close(),
  };
});

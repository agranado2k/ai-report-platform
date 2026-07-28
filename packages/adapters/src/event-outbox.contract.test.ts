// Runs the shared EventOutbox contract (arp-application/testing) against
// DrizzleEventOutbox on pglite (ADR-0046, ADR-0021) — the same suite that runs
// against InMemoryEventOutbox in packages/application/src/testing/contracts/
// event-outbox.contract.test.ts. The read-back seam SELECTs the adapter's own
// outbox payload column (ordered by the uuidv7 id = insert order); adapter-only
// columns (status/aggregateId/eventType) remain covered by
// event-outbox.integration.test.ts.
import { describeEventOutboxContract } from "arp-application/testing";
import { outbox } from "arp-db/schema";
import type { DomainEvent } from "arp-domain";
import { asc } from "drizzle-orm";
import { DrizzleEventOutbox } from "./event-outbox";
import { makeTestDb } from "./testing/pglite";

describeEventOutboxContract("drizzle+pglite", async () => {
  const tdb = await makeTestDb();
  return {
    outbox: new DrizzleEventOutbox(tdb.ctx),
    async drained() {
      const rows = await tdb.ctx
        .current()
        .select({ payload: outbox.payload })
        .from(outbox)
        .orderBy(asc(outbox.id));
      return rows.map((r) => r.payload as DomainEvent);
    },
    teardown: () => tdb.close(),
  };
});

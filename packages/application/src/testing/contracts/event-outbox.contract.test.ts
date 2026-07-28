// Runs the shared EventOutbox contract against InMemoryEventOutbox.
// The same suite also runs against DrizzleEventOutbox on pglite from
// packages/adapters/src/event-outbox.contract.test.ts (ADR-0046, ADR-0021).
import { InMemoryEventOutbox } from "../in-memory";
import { describeEventOutboxContract } from "./event-outbox.contract";

describeEventOutboxContract("in-memory", async () => {
  const outbox = new InMemoryEventOutbox();
  return {
    outbox,
    drained: async () => outbox.drained(),
    async teardown() {},
  };
});

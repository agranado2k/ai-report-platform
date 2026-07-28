// Runs the shared UnitOfWork contract against TransactionalInMemoryUnitOfWork.
// The same suite also runs against DrizzleUnitOfWork on pglite from
// packages/adapters/src/unit-of-work.contract.test.ts (ADR-0046, ADR-0037 §5).
// The observable effect here is an InMemoryEventOutbox enqueue — the same
// participant the adapter run observes via a real outbox row.
import { type DomainEvent, reportId, versionId } from "arp-domain";
import { InMemoryEventOutbox, TransactionalInMemoryUnitOfWork } from "../in-memory";
import { describeUnitOfWorkContract } from "./unit-of-work.contract";

const EFFECT_EVENT: DomainEvent = {
  type: "ReportPublished",
  reportId: reportId("00000000-0000-4000-8000-0000000000a1"),
  versionId: versionId("00000000-0000-4000-8000-0000000000b1"),
  firstPublish: true,
};

describeUnitOfWorkContract("in-memory", async () => {
  const outbox = new InMemoryEventOutbox();
  return {
    uow: new TransactionalInMemoryUnitOfWork([outbox]),
    writeEffect: () => outbox.enqueue([EFFECT_EVENT]),
    committedCount: async () => outbox.drained().length,
    async teardown() {},
  };
});

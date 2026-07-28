// Shared EventOutbox contract (ADR-0021 transactional outbox, ADR-0046
// two-tier testing). Run this ONE suite against both the InMemoryEventOutbox
// fake (packages/application/src/testing/contracts/event-outbox.contract.test.ts)
// and DrizzleEventOutbox on pglite
// (packages/adapters/src/event-outbox.contract.test.ts).
//
// The harness's `drained()` is the formalized read-back seam: the fake's
// `.drained()` affordance and a SELECT of the adapter's own outbox payload
// column expressed in ONE vocabulary — the enqueued DomainEvents, in enqueue
// order. Adapter-only columns (status/aggregateId/eventType) stay in the
// adapter integration test.
import { commentId, type DomainEvent, reportId, userId, versionId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventOutbox } from "../../ports";

export interface EventOutboxContractHarness {
  readonly outbox: EventOutbox;
  /** The events enqueued so far, in enqueue order. */
  drained(): Promise<readonly DomainEvent[]>;
  /** Release whatever the harness allocated; a no-op for the in-memory fake. */
  teardown(): Promise<void>;
}

// UUID-shaped ids: the real outbox's aggregate_id/payload columns require
// valid UUID text, and the fake tolerates them just as well.
const REPORT_ID = reportId("00000000-0000-4000-8000-0000000000a1");

const uploaded: DomainEvent = {
  type: "ReportVersionUploaded",
  reportId: REPORT_ID,
  versionId: versionId("00000000-0000-4000-8000-0000000000b1"),
  versionNo: 1,
  origin: "upload",
};

const published: DomainEvent = {
  type: "ReportPublished",
  reportId: REPORT_ID,
  versionId: versionId("00000000-0000-4000-8000-0000000000b1"),
  firstPublish: true,
};

const commentAdded: DomainEvent = {
  type: "CommentAdded",
  commentId: commentId("00000000-0000-4000-8000-0000000000c1"),
  reportId: REPORT_ID,
  authorUserId: userId("00000000-0000-4000-8000-000000000002"),
  parentCommentId: null,
};

/**
 * Runs the EventOutbox contract against `setup()`'s implementation. `label`
 * distinguishes the two runs in test output (e.g. "in-memory" vs
 * "drizzle+pglite"). `setup()` is called fresh before EVERY test.
 */
export function describeEventOutboxContract(
  label: string,
  setup: () => Promise<EventOutboxContractHarness>,
): void {
  describe(`EventOutbox contract (${label})`, () => {
    let h: EventOutboxContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("round-trips one event — the full payload readable back", async () => {
      const r = await h.outbox.enqueue([uploaded]);
      expect(r.ok).toBe(true);
      expect(await h.drained()).toEqual([uploaded]);
    });

    it("is a no-op for an empty event list", async () => {
      const r = await h.outbox.enqueue([]);
      expect(r.ok).toBe(true);
      expect(await h.drained()).toEqual([]);
    });

    it("preserves order for multiple events in one enqueue", async () => {
      const r = await h.outbox.enqueue([uploaded, published]);
      expect(r.ok).toBe(true);
      expect((await h.drained()).map((e) => e.type)).toEqual([
        "ReportVersionUploaded",
        "ReportPublished",
      ]);
    });

    it("accumulates events across successive enqueues, in call order", async () => {
      await h.outbox.enqueue([uploaded]);
      await h.outbox.enqueue([published]);
      expect((await h.drained()).map((e) => e.type)).toEqual([
        "ReportVersionUploaded",
        "ReportPublished",
      ]);
    });

    it("round-trips a Comment-aggregate event's distinct payload shape (ADR-0064)", async () => {
      const r = await h.outbox.enqueue([commentAdded]);
      expect(r.ok).toBe(true);
      expect(await h.drained()).toEqual([commentAdded]);
    });
  });
}

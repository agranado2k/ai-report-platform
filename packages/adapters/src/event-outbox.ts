// DrizzleEventOutbox — appends domain events to the transactional outbox
// (ADR-0021) in the same tx as the state change. A relay worker (later)
// delivers them; here we only enqueue.
import type { EventOutbox } from "arp-application";
import { outbox } from "arp-db/schema";
import { type AppError, type DomainEvent, ok, type Result } from "arp-domain";
import { v7 as uuidv7 } from "uuid";
import type { DbContext } from "./client";

export class DrizzleEventOutbox implements EventOutbox {
  constructor(private readonly ctx: DbContext) {}

  async enqueue(events: readonly DomainEvent[]): Promise<Result<void, AppError>> {
    if (events.length === 0) return ok(undefined);
    try {
      const rows = events.map((e) => ({
        id: uuidv7(),
        eventType: e.type,
        aggregateId: e.reportId, // every Phase-1 event is on the Report aggregate
        payload: e,
        status: "pending" as const,
      }));
      await this.ctx.current().insert(outbox).values(rows);
      return ok(undefined);
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: "Unexpected",
          message: `outbox.enqueue: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
  }
}

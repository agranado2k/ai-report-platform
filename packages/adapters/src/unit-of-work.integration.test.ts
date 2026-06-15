// Integration test for DrizzleUnitOfWork commit-last atomicity (ADR-0037 §5)
// against real Postgres (pglite): writes inside run() commit together, and a
// domain `err` rolls ALL of them back.

import { outbox } from "arp-db/schema";
import { err, ok } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleEventOutbox } from "./event-outbox";
import { makeTestDb, sampleReport, type TestDb } from "./testing/pglite";
import { DrizzleUnitOfWork } from "./unit-of-work";

describe("DrizzleUnitOfWork (pglite integration) — commit-last atomicity", () => {
  let tdb: TestDb;
  let uow: DrizzleUnitOfWork;
  let store: DrizzleEventOutbox;

  beforeEach(async () => {
    tdb = await makeTestDb();
    uow = new DrizzleUnitOfWork(tdb.ctx);
    store = new DrizzleEventOutbox(tdb.ctx);
  });
  afterEach(() => tdb.close());

  it("commits writes made inside run() when the work returns ok", async () => {
    const events = sampleReport().events;

    const r = await uow.run(async () => {
      const e = await store.enqueue(events);
      return e.ok ? ok("done") : e;
    });

    expect(r.ok && r.value).toBe("done");
    const rows = await tdb.ctx.current().select().from(outbox);
    expect(rows).toHaveLength(events.length);
  });

  it("rolls back ALL writes when the work returns err", async () => {
    const events = sampleReport().events;

    const r = await uow.run(async () => {
      await store.enqueue(events); // would persist…
      return err({ kind: "ValidationError", message: "boom" }); // …but this rolls it back
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
    const rows = await tdb.ctx.current().select().from(outbox);
    expect(rows).toHaveLength(0);
  });
});

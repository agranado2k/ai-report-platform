// Integration tests for DrizzleEventOutbox against real Postgres (pglite).

import { outbox } from "arp-db/schema";
import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleEventOutbox } from "./event-outbox";
import { makeTestDb, type TestDb } from "./testing/pglite";

function buildEvents() {
  const slug = makeSlug("abcde12345");
  if (!slug.ok) throw new Error("bad slug");
  return createReport({
    id: reportId("00000000-0000-4000-8000-0000000000a1"),
    orgId: orgId("00000000-0000-4000-8000-000000000001"),
    folderId: folderId("00000000-0000-4000-8000-000000000003"),
    slug: slug.value,
    title: "T",
    versionId: versionId("00000000-0000-4000-8000-0000000000b1"),
    contentHash: "a".repeat(64),
    uploadedBy: userId("00000000-0000-4000-8000-000000000002"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  }).events;
}

describe("DrizzleEventOutbox (pglite integration)", () => {
  let tdb: TestDb;
  let store: DrizzleEventOutbox;

  beforeEach(async () => {
    tdb = await makeTestDb();
    store = new DrizzleEventOutbox(tdb.ctx);
  });
  afterEach(() => tdb.close());

  it("appends each event as a pending outbox row carrying its type", async () => {
    const events = buildEvents();
    expect(events.length).toBeGreaterThan(0);

    const r = await store.enqueue(events);
    expect(r.ok).toBe(true);

    const rows = await tdb.ctx.current().select().from(outbox);
    expect(rows).toHaveLength(events.length);
    expect(rows.every((x) => x.status === "pending")).toBe(true);
    expect(rows.map((x) => x.eventType).sort()).toEqual(events.map((e) => e.type).sort());
  });

  it("is a no-op for an empty event list", async () => {
    const r = await store.enqueue([]);
    expect(r.ok).toBe(true);
    const rows = await tdb.ctx.current().select().from(outbox);
    expect(rows).toHaveLength(0);
  });
});

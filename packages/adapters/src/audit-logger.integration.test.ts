// Integration tests for DrizzleAuditLogger against real Postgres (pglite).
import { auditLog } from "arp-db/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleAuditLogger } from "./audit-logger";
import { makeTestDb, type SeededIdentity, seedIdentity, type TestDb } from "./testing/pglite";

describe("DrizzleAuditLogger (pglite integration)", () => {
  let tdb: TestDb;
  let store: DrizzleAuditLogger;
  let ids: SeededIdentity;

  beforeEach(async () => {
    tdb = await makeTestDb();
    ids = await seedIdentity(tdb.ctx);
    store = new DrizzleAuditLogger(tdb.ctx);
  });
  afterEach(() => tdb.close());

  it("appends each entry as an audit_log row carrying the mapped columns", async () => {
    const r = await store.record([
      {
        action: "report.uploaded",
        orgId: ids.orgId,
        actorUserId: ids.userId,
        targetType: "report",
        targetId: "00000000-0000-4000-8000-0000000000a1",
        meta: { versionId: "00000000-0000-4000-8000-0000000000b1" },
      },
    ]);
    expect(r.ok).toBe(true);

    const rows = await tdb.ctx.current().select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: ids.orgId,
      actorUserId: ids.userId,
      action: "report.uploaded",
      targetType: "report",
      targetId: "00000000-0000-4000-8000-0000000000a1",
      metaJson: { versionId: "00000000-0000-4000-8000-0000000000b1" },
      ipHash: null,
      geo: null,
    });
    expect(rows[0]?.id).toBeTruthy();
    expect(rows[0]?.at).toBeTruthy();
  });

  it("maps a null actorUserId through (system-adjacent but still org-scoped actions)", async () => {
    const r = await store.record([
      {
        action: "report.deleted",
        orgId: ids.orgId,
        actorUserId: null,
        targetType: "report",
        targetId: "00000000-0000-4000-8000-0000000000a1",
      },
    ]);
    expect(r.ok).toBe(true);

    const rows = await tdb.ctx.current().select().from(auditLog);
    expect(rows[0]?.actorUserId).toBeNull();
    expect(rows[0]?.metaJson).toEqual({});
  });

  it("is a no-op for an empty entry list", async () => {
    const r = await store.record([]);
    expect(r.ok).toBe(true);
    const rows = await tdb.ctx.current().select().from(auditLog);
    expect(rows).toHaveLength(0);
  });
});

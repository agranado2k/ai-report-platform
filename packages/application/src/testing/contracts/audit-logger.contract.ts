// Shared AuditLogger contract (ADR-0070 write seam, ADR-0046 two-tier
// testing). Run this ONE suite against both the InMemoryAuditLogger fake
// (packages/application/src/testing/contracts/audit-logger.contract.test.ts)
// and DrizzleAuditLogger on pglite
// (packages/adapters/src/audit-logger.contract.test.ts).
//
// The harness's `recorded()` is the formalized read-back seam: the fake's
// `.recorded()` affordance and a SELECT over the adapter's own audit_log table
// expressed in ONE vocabulary — port-shaped entries with `meta` normalized to
// `{}` when the writer omitted it (the adapter's `meta ?? {}` column mapping is
// the contract; the fake harness applies the same normalization on read).
// Adapter-only columns (ipHash/geo/at) stay in the adapter integration test.
import type { OrgId, UserId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry } from "../../audit";
import type { AuditLogger } from "../../ports";

/** A read-back entry: the port's AuditEntry with `meta` always present. */
export type RecordedAuditEntry = Omit<AuditEntry, "meta"> & {
  readonly meta: Readonly<Record<string, unknown>>;
};

export interface AuditLoggerContractHarness {
  readonly audit: AuditLogger;
  /** An org the implementation accepts rows for (the real adapter's FK). */
  readonly orgId: OrgId;
  /** A user in that org, for `actorUserId` (nullable in the port). */
  readonly actorUserId: UserId;
  /** Everything recorded so far, in record order, meta-normalized (see header). */
  recorded(): Promise<readonly RecordedAuditEntry[]>;
  /** Release whatever the harness allocated; a no-op for the in-memory fake. */
  teardown(): Promise<void>;
}

/**
 * Runs the AuditLogger contract against `setup()`'s implementation. `label`
 * distinguishes the two runs in test output (e.g. "in-memory" vs
 * "drizzle+pglite"). `setup()` is called fresh before EVERY test.
 */
export function describeAuditLoggerContract(
  label: string,
  setup: () => Promise<AuditLoggerContractHarness>,
): void {
  describe(`AuditLogger contract (${label})`, () => {
    let h: AuditLoggerContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
      action: "report.uploaded",
      orgId: h.orgId,
      actorUserId: h.actorUserId,
      targetType: "report",
      targetId: "00000000-0000-4000-8000-0000000000a1",
      meta: { versionId: "00000000-0000-4000-8000-0000000000b1" },
      ...overrides,
    });

    it("round-trips one entry — every port field readable back, meta intact", async () => {
      const r = await h.audit.record([entry()]);
      expect(r.ok).toBe(true);

      expect(await h.recorded()).toEqual([
        {
          action: "report.uploaded",
          orgId: h.orgId,
          actorUserId: h.actorUserId,
          targetType: "report",
          targetId: "00000000-0000-4000-8000-0000000000a1",
          meta: { versionId: "00000000-0000-4000-8000-0000000000b1" },
        },
      ]);
    });

    it("accepts a null actorUserId (system-adjacent but still org-scoped actions)", async () => {
      const r = await h.audit.record([entry({ actorUserId: null })]);
      expect(r.ok).toBe(true);
      const rows = await h.recorded();
      expect(rows[0]?.actorUserId).toBeNull();
    });

    it("normalizes an omitted meta to {} on read-back", async () => {
      const r = await h.audit.record([entry({ meta: undefined })]);
      expect(r.ok).toBe(true);
      const rows = await h.recorded();
      expect(rows[0]?.meta).toEqual({});
    });

    it("is a no-op for an empty entry list", async () => {
      const r = await h.audit.record([]);
      expect(r.ok).toBe(true);
      expect(await h.recorded()).toEqual([]);
    });

    it("records multiple entries from one call in order", async () => {
      const r = await h.audit.record([
        entry({ action: "report.renamed", meta: { from: "A", to: "B" } }),
        entry({ action: "report.moved", meta: { fromFolderId: "f1", toFolderId: "f2" } }),
      ]);
      expect(r.ok).toBe(true);
      const rows = await h.recorded();
      expect(rows.map((e) => e.action)).toEqual(["report.renamed", "report.moved"]);
    });

    it("accumulates entries across successive record calls, in call order", async () => {
      await h.audit.record([entry({ action: "report.uploaded" })]);
      await h.audit.record([entry({ action: "report.deleted" })]);
      const rows = await h.recorded();
      expect(rows.map((e) => e.action)).toEqual(["report.uploaded", "report.deleted"]);
    });
  });
}

// Shared OrgWriteGrantStore contract (ADR-0078 §1). Run against BOTH
// InMemoryOrgWriteGrantStore and DrizzleOrgWriteGrantStore-on-pglite
// (ADR-0046), because `find` backs the third leg of the `canWrite`
// authorization decision — the two implementations disagreeing about whether a
// grant exists is an authorization bug, not a test-fixture detail.
//
// The store has no `findFor(actor)` and no email anywhere: the ORG MATCH is the
// application layer's job (`hasOrgWriteGrant`), which is why this suite asserts
// on the returned row's `orgId` rather than on any access decision.
import type { OrgId, ReportId, UserId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgWriteGrantStore } from "../../ports";

export interface OrgWriteGrantStoreContractHarness {
  readonly store: OrgWriteGrantStore;
  /** A report the grants are scoped to (a real FK on the Drizzle harness). */
  readonly reportId: ReportId;
  /** A SECOND report, so "one row per report" can be shown to mean per-report
   *  and not per-store. */
  readonly otherReportId: ReportId;
  /** The org that report belongs to (a real FK on the Drizzle harness). */
  readonly orgId: OrgId;
  /** An existing user to use as `granted_by` (a real FK on the Drizzle side). */
  readonly existingUserId: UserId;
  teardown(): Promise<void>;
}

export function describeOrgWriteGrantStoreContract(
  label: string,
  setup: () => Promise<OrgWriteGrantStoreContractHarness>,
): void {
  describe(`OrgWriteGrantStore contract (${label})`, () => {
    let h: OrgWriteGrantStoreContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("find returns null before anything is granted", async () => {
      const before = await h.store.find(h.reportId);
      expect(before.ok && before.value).toBeNull();
    });

    it("grant creates a row carrying the org and the grantor; revoke removes it", async () => {
      await h.store.grant(h.reportId, h.orgId, h.existingUserId);
      const found = await h.store.find(h.reportId);
      expect(found.ok && found.value).toMatchObject({
        reportId: h.reportId,
        orgId: h.orgId,
        grantedBy: h.existingUserId,
      });
      expect(found.ok && typeof found.value?.grantedAt).toBe("number");

      await h.store.revoke(h.reportId);
      const after = await h.store.find(h.reportId);
      expect(after.ok && after.value).toBeNull();
    });

    it("grant is an UPSERT — a second grant refreshes the same single row", async () => {
      // The PK is report_id alone (a report belongs to exactly one org), so a
      // re-grant must not raise a conflict and must not accumulate rows.
      await h.store.grant(h.reportId, h.orgId, h.existingUserId);
      const again = await h.store.grant(h.reportId, h.orgId, h.existingUserId);
      expect(again.ok).toBe(true);
      const found = await h.store.find(h.reportId);
      expect(found.ok && found.value?.orgId).toBe(h.orgId);
    });

    it("revoke is idempotent — revoking an absent grant still succeeds", async () => {
      // A stale panel or a double-click must never surface a false failure,
      // and the three-state control revokes unconditionally on the way to
      // `private`.
      const r = await h.store.revoke(h.reportId);
      expect(r.ok).toBe(true);
    });

    it("a grant on one report does NOT leak to another", async () => {
      await h.store.grant(h.reportId, h.orgId, h.existingUserId);
      const other = await h.store.find(h.otherReportId);
      expect(other.ok && other.value).toBeNull();
    });

    it("revoking one report's grant leaves another's intact", async () => {
      await h.store.grant(h.reportId, h.orgId, h.existingUserId);
      await h.store.grant(h.otherReportId, h.orgId, h.existingUserId);
      await h.store.revoke(h.reportId);
      const survivor = await h.store.find(h.otherReportId);
      expect(survivor.ok && survivor.value?.reportId).toBe(h.otherReportId);
    });
  });
}

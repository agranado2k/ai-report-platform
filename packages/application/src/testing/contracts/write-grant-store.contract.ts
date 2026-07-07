// Shared WriteGrantStore contract (ADR-0060). Run against both
// InMemoryWriteGrantStore and DrizzleWriteGrantStore-on-pglite — grant/revoke/
// listByReport/findFor and the dual userId-or-email match (a grantee's
// `grantee_user_id` may still be null if they hadn't signed up at grant time,
// ADR-0060 §2) must agree on both sides, since `findFor` backs the `canWrite`
// seam's authorization decision.
import type { ReportId, UserId } from "arp-domain";
import { userId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WriteGrantStore } from "../../ports";

export interface WriteGrantStoreContractHarness {
  readonly store: WriteGrantStore;
  /** A report id the store's grants are scoped to (a real FK to a saved
   *  report on the Drizzle harness; any id at all on the fake). */
  readonly reportId: ReportId;
  /** A user id that exists (a real FK on the Drizzle harness) to use as
   *  `grantedBy` / an opportunistically-resolved `grantee_user_id`. */
  readonly existingUserId: UserId;
  teardown(): Promise<void>;
}

const STRANGER: UserId = userId("00000000-0000-7000-8000-00000000dead");

export function describeWriteGrantStoreContract(
  label: string,
  setup: () => Promise<WriteGrantStoreContractHarness>,
): void {
  describe(`WriteGrantStore contract (${label})`, () => {
    let h: WriteGrantStoreContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("grant creates a row findFor can match by email; revoke removes it", async () => {
      const before = await h.store.findFor(h.reportId, { userId: STRANGER, email: "a@b.com" });
      expect(before.ok && before.value).toBeNull();

      await h.store.grant(h.reportId, "a@b.com", h.existingUserId, null);
      const found = await h.store.findFor(h.reportId, { userId: STRANGER, email: "a@b.com" });
      expect(found.ok && found.value?.granteeEmail).toBe("a@b.com");
      expect(found.ok && found.value?.granteeUserId).toBeNull();

      await h.store.revoke(h.reportId, "a@b.com");
      const after = await h.store.findFor(h.reportId, { userId: STRANGER, email: "a@b.com" });
      expect(after.ok && after.value).toBeNull();
    });

    it("matches by granteeUserId even when the caller's email differs", async () => {
      await h.store.grant(h.reportId, "grantee@x.com", h.existingUserId, h.existingUserId);
      const found = await h.store.findFor(h.reportId, {
        userId: h.existingUserId,
        email: "unrelated@x.com",
      });
      expect(found.ok && found.value?.granteeEmail).toBe("grantee@x.com");
    });

    it("a grant with no resolved granteeUserId still matches by email only (ADR-0060 §2)", async () => {
      await h.store.grant(h.reportId, "not-signed-up@x.com", h.existingUserId, null);
      const found = await h.store.findFor(h.reportId, {
        userId: STRANGER,
        email: "not-signed-up@x.com",
      });
      expect(found.ok && found.value?.granteeEmail).toBe("not-signed-up@x.com");
    });

    it("matches email normalized — case-insensitive and trimmed", async () => {
      await h.store.grant(h.reportId, "A@B.com", h.existingUserId, null);
      const found = await h.store.findFor(h.reportId, { userId: STRANGER, email: "  a@b.COM  " });
      expect(found.ok && found.value).not.toBeNull();
      await h.store.revoke(h.reportId, "  A@B.COM ");
      const after = await h.store.findFor(h.reportId, { userId: STRANGER, email: "a@b.com" });
      expect(after.ok && after.value).toBeNull();
    });

    it("grant upserts in place — no PK conflict on a re-grant", async () => {
      await h.store.grant(h.reportId, "a@b.com", h.existingUserId, null);
      await h.store.grant(h.reportId, "a@b.com", h.existingUserId, h.existingUserId);
      const found = await h.store.findFor(h.reportId, { userId: STRANGER, email: "a@b.com" });
      expect(found.ok && found.value?.granteeUserId).toBe(h.existingUserId);
    });

    it("no match when neither userId nor email match anything granted", async () => {
      await h.store.grant(h.reportId, "a@b.com", h.existingUserId, null);
      const found = await h.store.findFor(h.reportId, { userId: STRANGER, email: "c@d.com" });
      expect(found.ok && found.value).toBeNull();
    });

    it("listByReport returns every grant on the report", async () => {
      await h.store.grant(h.reportId, "a@b.com", h.existingUserId, null);
      await h.store.grant(h.reportId, "c@d.com", h.existingUserId, h.existingUserId);
      const listed = await h.store.listByReport(h.reportId);
      expect(listed.ok && listed.value.map((g) => g.granteeEmail).sort()).toEqual([
        "a@b.com",
        "c@d.com",
      ]);
    });

    it("listByReport is empty after every grant is revoked", async () => {
      await h.store.grant(h.reportId, "a@b.com", h.existingUserId, null);
      await h.store.revoke(h.reportId, "a@b.com");
      const listed = await h.store.listByReport(h.reportId);
      expect(listed.ok && listed.value).toEqual([]);
    });
  });
}

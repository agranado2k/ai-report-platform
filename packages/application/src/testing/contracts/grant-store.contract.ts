// Shared GrantStore contract (ADR-0056 revocation-C). Run against both
// InMemoryGrantStore and DrizzleGrantStore-on-pglite — the allowlist grant
// lifecycle (grant/isGranted/revoke/revokeAll), expiry, upsert-in-place, and
// the normalized (trim + lowercase) email match must agree on both sides,
// since the viewer's per-request check (`isGranted`) is security-relevant.
import type { ReportId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GrantStore } from "../../ports";

export interface GrantStoreContractHarness {
  readonly store: GrantStore;
  /** A report id the store's grants are scoped to (a real FK to a saved
   *  report on the Drizzle harness; any id at all on the fake). */
  readonly reportId: ReportId;
  teardown(): Promise<void>;
}

async function isLive(store: GrantStore, reportId: ReportId, email: string): Promise<boolean> {
  const r = await store.isGranted(reportId, email);
  if (!r.ok) throw new Error("isGranted failed");
  return r.value;
}

export function describeGrantStoreContract(
  label: string,
  setup: () => Promise<GrantStoreContractHarness>,
): void {
  describe(`GrantStore contract (${label})`, () => {
    let h: GrantStoreContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("grant makes a live grant; revoke removes it (immediate revocation)", async () => {
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(false);
      await h.store.grant(h.reportId, "a@b.com", Date.now() + 60_000);
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(true);
      await h.store.revoke(h.reportId, "a@b.com");
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(false);
    });

    it("an expired grant is not live", async () => {
      await h.store.grant(h.reportId, "a@b.com", Date.now() - 1_000);
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(false);
    });

    it("grant upserts in place (refreshes expiry, no PK conflict)", async () => {
      await h.store.grant(h.reportId, "a@b.com", Date.now() - 1_000); // expired
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(false);
      await h.store.grant(h.reportId, "a@b.com", Date.now() + 60_000); // refresh → live
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(true);
    });

    it("matches email normalized — case-insensitive and trimmed", async () => {
      await h.store.grant(h.reportId, "A@B.com", Date.now() + 60_000);
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(true);
      await h.store.revoke(h.reportId, "  A@B.COM ");
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(false);
    });

    it("revokeAll clears every grant for the report", async () => {
      await h.store.grant(h.reportId, "a@b.com", Date.now() + 60_000);
      await h.store.grant(h.reportId, "c@d.io", Date.now() + 60_000);
      await h.store.revokeAll(h.reportId);
      expect(await isLive(h.store, h.reportId, "a@b.com")).toBe(false);
      expect(await isLive(h.store, h.reportId, "c@d.io")).toBe(false);
    });
  });
}

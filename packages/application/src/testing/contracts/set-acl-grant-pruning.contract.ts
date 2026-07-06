// Shared setAcl grant-pruning contract (ADR-0056 "5e", issue #137). The
// `setAcl` use case must prune durable `report_grants` rows so they never
// outlive the Acl that granted them: revoke every grant when the mode
// switches away from `allowlist`, and revoke just the removed email(s) when
// it stays `allowlist` but the roster narrows. Run against both
// InMemoryGrantStore/InMemoryReportRepository
// (packages/application/src/testing/contracts/set-acl-grant-pruning.contract.test.ts)
// and DrizzleGrantStore/DrizzleReportRepository on pglite
// (packages/adapters/src/set-acl-grant-pruning.contract.test.ts) — pruning is
// security-relevant (the viewer's live `isGranted` check trusts the grant row,
// not the Acl), so both authoring sides must agree.
import type { OrgId, ReportId, Slug } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GrantStore, PasswordHasher, ReportRepository } from "../../ports";
import { setAcl } from "../../use-cases/set-acl";

export interface SetAclGrantPruningHarness {
  readonly reports: ReportRepository;
  readonly grants: GrantStore;
  readonly hasher: PasswordHasher;
  /** The org that owns the pre-seeded report (matches the actor used below). */
  readonly orgId: OrgId;
  /** The pre-seeded report's id + slug — every test drives `setAcl` against it. */
  readonly reportId: ReportId;
  readonly slug: Slug;
  /** Release whatever the harness allocated (e.g. close a pglite db); a no-op
   *  for the in-memory fakes. */
  teardown(): Promise<void>;
}

function actorFor(orgId: OrgId) {
  return { orgId, scopes: ["acl:write"] };
}

async function isLive(store: GrantStore, reportId: ReportId, email: string): Promise<boolean> {
  const r = await store.isGranted(reportId, email);
  if (!r.ok) throw new Error("isGranted failed");
  return r.value;
}

/**
 * Runs the setAcl grant-pruning contract against `setup()`'s implementation.
 * `label` distinguishes the two runs in test output (e.g. "in-memory" vs
 * "drizzle+pglite"). `setup()` is called fresh before EVERY test.
 */
export function describeSetAclGrantPruningContract(
  label: string,
  setup: () => Promise<SetAclGrantPruningHarness>,
): void {
  describe(`setAcl grant pruning (${label})`, () => {
    let h: SetAclGrantPruningHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("mode switch allowlist → password revokes every grant for the report", async () => {
      const deps = { reports: h.reports, hasher: h.hasher, grants: h.grants };
      const allow = await setAcl(deps, actorFor(h.orgId), {
        slug: h.slug,
        mode: "allowlist",
        allowedEmails: ["a@b.com", "c@d.io"],
      });
      expect(allow.ok).toBe(true);
      // Grants are created by redeem-magic-link on a real magic-link redeem, not
      // by setAcl itself — simulate two already-redeemed grants here.
      await h.grants.grant(h.reportId, "a@b.com", Date.now() + 60_000);
      await h.grants.grant(h.reportId, "c@d.io", Date.now() + 60_000);
      expect(await isLive(h.grants, h.reportId, "a@b.com")).toBe(true);
      expect(await isLive(h.grants, h.reportId, "c@d.io")).toBe(true);

      const switched = await setAcl(deps, actorFor(h.orgId), {
        slug: h.slug,
        mode: "password",
        password: "hunter22",
      });
      expect(switched.ok).toBe(true);
      expect(await isLive(h.grants, h.reportId, "a@b.com")).toBe(false);
      expect(await isLive(h.grants, h.reportId, "c@d.io")).toBe(false);
    });

    it("allowlist stays but a removed email's grant is revoked; kept emails are untouched", async () => {
      const deps = { reports: h.reports, hasher: h.hasher, grants: h.grants };
      const allow = await setAcl(deps, actorFor(h.orgId), {
        slug: h.slug,
        mode: "allowlist",
        allowedEmails: ["a@b.com", "c@d.io"],
      });
      expect(allow.ok).toBe(true);
      await h.grants.grant(h.reportId, "a@b.com", Date.now() + 60_000);
      await h.grants.grant(h.reportId, "c@d.io", Date.now() + 60_000);

      const narrowed = await setAcl(deps, actorFor(h.orgId), {
        slug: h.slug,
        mode: "allowlist",
        allowedEmails: ["c@d.io"],
      });
      expect(narrowed.ok).toBe(true);
      expect(await isLive(h.grants, h.reportId, "a@b.com")).toBe(false); // removed → revoked
      expect(await isLive(h.grants, h.reportId, "c@d.io")).toBe(true); // kept → untouched
    });

    it("a non-allowlist → non-allowlist switch never touches grants", async () => {
      const deps = { reports: h.reports, hasher: h.hasher, grants: h.grants };
      const pub = await setAcl(deps, actorFor(h.orgId), { slug: h.slug, mode: "public" });
      expect(pub.ok).toBe(true);
      // A grant that (by hypothesis) shouldn't exist while public — proves the
      // switch below doesn't blindly revoke/revokeAll on every call.
      await h.grants.grant(h.reportId, "stray@example.com", Date.now() + 60_000);

      const org = await setAcl(deps, actorFor(h.orgId), { slug: h.slug, mode: "org" });
      expect(org.ok).toBe(true);
      expect(await isLive(h.grants, h.reportId, "stray@example.com")).toBe(true); // untouched
    });
  });
}

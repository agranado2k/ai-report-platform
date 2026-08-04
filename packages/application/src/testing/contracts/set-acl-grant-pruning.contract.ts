// Shared setAcl grant-pruning contract (ADR-0056 "5e", issue #137; extended by
// ADR-0078 §11). The `setAcl` use case must prune durable grants so they never
// outlive the Acl that granted them, on BOTH grant families:
//
//  - `report_grants` (the ADR-0056 allowlist redemptions): revoke every grant
//    when the mode switches away from `allowlist`, and revoke just the removed
//    email(s) when it stays `allowlist` but the roster narrows.
//  - `report_org_write_grants` (the ADR-0078 org-write leg): revoke the row
//    whenever the new mode is not `org`. An org-write row on a report the org
//    cannot read is the one combination ADR-0060 §6 forbids, and `setAcl` is a
//    SECOND door onto the same Acl `setReportSharing` writes — a rule enforced
//    at only one of two doors is not enforced.
//
// Run against both InMemoryGrantStore/InMemoryReportRepository
// (packages/application/src/testing/contracts/set-acl-grant-pruning.contract.test.ts)
// and DrizzleGrantStore/DrizzleReportRepository on pglite
// (packages/adapters/src/set-acl-grant-pruning.contract.test.ts) — pruning is
// security-relevant (the viewer's live `isGranted` check trusts the grant row,
// not the Acl), so both authoring sides must agree.
import type { OrgId, ReportId, Slug, UserId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuditLogger,
  GrantStore,
  OrgWriteGrantStore,
  PasswordHasher,
  ReportRepository,
  UnitOfWork,
} from "../../ports";
import { setAcl } from "../../use-cases/set-acl";
import { idempotencyTestDeps } from "../in-memory";

export interface SetAclGrantPruningHarness {
  readonly reports: ReportRepository;
  readonly grants: GrantStore;
  /** The ADR-0078 org-write grant store — the second durable grant family the
   *  Acl authorizes, and the one `setAcl` must not leave behind. */
  readonly orgWriteGrants: OrgWriteGrantStore;
  readonly hasher: PasswordHasher;
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
  /** The org hosting the pre-seeded report (matches the actor used below). */
  readonly orgId: OrgId;
  /** The pre-seeded report's OWNER — setAcl is owner-gated (ADR-0059). */
  readonly userId: UserId;
  /** The pre-seeded report's id + slug — every test drives `setAcl` against it. */
  readonly reportId: ReportId;
  readonly slug: Slug;
  /** Release whatever the harness allocated (e.g. close a pglite db); a no-op
   *  for the in-memory fakes. */
  teardown(): Promise<void>;
}

function actorFor(orgId: OrgId, userId: UserId) {
  return { orgId, userId, scopes: ["acl:write"] };
}

async function isLive(store: GrantStore, reportId: ReportId, email: string): Promise<boolean> {
  const r = await store.isGranted(reportId, email);
  if (!r.ok) throw new Error("isGranted failed");
  return r.value;
}

async function hasOrgWrite(store: OrgWriteGrantStore, reportId: ReportId): Promise<boolean> {
  const r = await store.find(reportId);
  if (!r.ok) throw new Error("orgWriteGrants.find failed");
  return r.value !== null;
}

/** The `setAcl` deps, built once from the harness — every test drives the same
 *  wiring, so a new dep is added in ONE place rather than four. */
function depsFor(h: SetAclGrantPruningHarness) {
  return {
    reports: h.reports,
    hasher: h.hasher,
    grants: h.grants,
    orgWriteGrants: h.orgWriteGrants,
    audit: h.audit,
    uow: h.uow,
    ...idempotencyTestDeps(),
  };
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
      const deps = depsFor(h);
      const allow = await setAcl(deps, actorFor(h.orgId, h.userId), {
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

      const switched = await setAcl(deps, actorFor(h.orgId, h.userId), {
        slug: h.slug,
        mode: "password",
        password: "hunter22",
      });
      expect(switched.ok).toBe(true);
      expect(await isLive(h.grants, h.reportId, "a@b.com")).toBe(false);
      expect(await isLive(h.grants, h.reportId, "c@d.io")).toBe(false);
    });

    it("allowlist stays but a removed email's grant is revoked; kept emails are untouched", async () => {
      const deps = depsFor(h);
      const allow = await setAcl(deps, actorFor(h.orgId, h.userId), {
        slug: h.slug,
        mode: "allowlist",
        allowedEmails: ["a@b.com", "c@d.io"],
      });
      expect(allow.ok).toBe(true);
      await h.grants.grant(h.reportId, "a@b.com", Date.now() + 60_000);
      await h.grants.grant(h.reportId, "c@d.io", Date.now() + 60_000);
      // Assert the pre-state so the revocation below can't pass vacuously.
      expect(await isLive(h.grants, h.reportId, "a@b.com")).toBe(true);
      expect(await isLive(h.grants, h.reportId, "c@d.io")).toBe(true);

      const narrowed = await setAcl(deps, actorFor(h.orgId, h.userId), {
        slug: h.slug,
        mode: "allowlist",
        allowedEmails: ["c@d.io"],
      });
      expect(narrowed.ok).toBe(true);
      expect(await isLive(h.grants, h.reportId, "a@b.com")).toBe(false); // removed → revoked
      expect(await isLive(h.grants, h.reportId, "c@d.io")).toBe(true); // kept → untouched
    });

    it("allowlist widening (additions only) leaves existing grants untouched", async () => {
      const deps = depsFor(h);
      const allow = await setAcl(deps, actorFor(h.orgId, h.userId), {
        slug: h.slug,
        mode: "allowlist",
        allowedEmails: ["a@b.com"],
      });
      expect(allow.ok).toBe(true);
      await h.grants.grant(h.reportId, "a@b.com", Date.now() + 60_000);
      expect(await isLive(h.grants, h.reportId, "a@b.com")).toBe(true);

      const widened = await setAcl(deps, actorFor(h.orgId, h.userId), {
        slug: h.slug,
        mode: "allowlist",
        allowedEmails: ["a@b.com", "c@d.io"],
      });
      expect(widened.ok).toBe(true);
      // A re-added / kept email must NOT need to re-redeem a magic link.
      expect(await isLive(h.grants, h.reportId, "a@b.com")).toBe(true);
    });

    it("a non-allowlist → non-allowlist switch never touches grants", async () => {
      const deps = depsFor(h);
      const pub = await setAcl(deps, actorFor(h.orgId, h.userId), { slug: h.slug, mode: "public" });
      expect(pub.ok).toBe(true);
      // A grant that (by hypothesis) shouldn't exist while public — proves the
      // switch below doesn't blindly revoke/revokeAll on every call.
      await h.grants.grant(h.reportId, "stray@example.com", Date.now() + 60_000);

      const org = await setAcl(deps, actorFor(h.orgId, h.userId), { slug: h.slug, mode: "org" });
      expect(org.ok).toBe(true);
      expect(await isLive(h.grants, h.reportId, "stray@example.com")).toBe(true); // untouched
    });

    // ── ADR-0078 §11: the org-write grant is pruned by the SAME rule ────────
    //
    // `setReportSharing` is not the only door onto a report's Acl. Narrowing
    // via `POST /reports/{slug}/acl` (or MCP `reports_set_acl`) must revoke the
    // org-write row too, or the org keeps WRITE — and, through the ADR-0078 §8
    // listing leg and the ADR-0063 edit-token door, keeps READ — on a report
    // the Acl says they cannot open.
    for (const mode of ["private", "password", "allowlist", "public"] as const) {
      it(`narrowing org → ${mode} revokes the org write grant`, async () => {
        const deps = depsFor(h);
        const shared = await setAcl(deps, actorFor(h.orgId, h.userId), {
          slug: h.slug,
          mode: "org",
        });
        expect(shared.ok).toBe(true);
        await h.orgWriteGrants.grant(h.reportId, h.orgId, h.userId);
        // Assert the pre-state so the revocation below can't pass vacuously.
        expect(await hasOrgWrite(h.orgWriteGrants, h.reportId)).toBe(true);

        const narrowed = await setAcl(deps, actorFor(h.orgId, h.userId), {
          slug: h.slug,
          mode,
          ...(mode === "password" ? { password: "hunter22" } : {}),
          ...(mode === "allowlist" ? { allowedEmails: ["a@b.com"] } : {}),
        });
        expect(narrowed.ok).toBe(true);
        expect(await hasOrgWrite(h.orgWriteGrants, h.reportId)).toBe(false);
      });
    }

    it("re-asserting org leaves an existing org write grant intact", async () => {
      // The recorded decision (ADR-0078 §11): `setAcl` with mode `org` neither
      // grants nor revokes org write — it is a READ authorization call, and the
      // pair it must preserve (`org` read + org write = `org_edit`) is still
      // intact. Revoking here would silently downgrade `org_edit` to `org_view`
      // on a call the owner made about reading.
      const deps = depsFor(h);
      const shared = await setAcl(deps, actorFor(h.orgId, h.userId), { slug: h.slug, mode: "org" });
      expect(shared.ok).toBe(true);
      await h.orgWriteGrants.grant(h.reportId, h.orgId, h.userId);
      expect(await hasOrgWrite(h.orgWriteGrants, h.reportId)).toBe(true);

      const again = await setAcl(deps, actorFor(h.orgId, h.userId), { slug: h.slug, mode: "org" });
      expect(again.ok).toBe(true);
      expect(await hasOrgWrite(h.orgWriteGrants, h.reportId)).toBe(true);
    });

    it("narrowing a report that never had an org write grant is a no-op", async () => {
      const deps = depsFor(h);
      const shared = await setAcl(deps, actorFor(h.orgId, h.userId), { slug: h.slug, mode: "org" });
      expect(shared.ok).toBe(true);
      expect(await hasOrgWrite(h.orgWriteGrants, h.reportId)).toBe(false);

      const narrowed = await setAcl(deps, actorFor(h.orgId, h.userId), {
        slug: h.slug,
        mode: "private",
      });
      expect(narrowed.ok).toBe(true);
      expect(await hasOrgWrite(h.orgWriteGrants, h.reportId)).toBe(false);
    });
  });
}

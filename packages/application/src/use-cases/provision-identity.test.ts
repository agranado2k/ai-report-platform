import { type AppError, clerkOrgId, clerkUserId, err, type Result } from "arp-domain";
import { describe, expect, it } from "vitest";
import type { ClerkIdentity, ClerkOrgProvisioner } from "../ports";
import { FakeClerkOrgProvisioner, InMemoryIdentityStore } from "../testing/in-memory";
import { provisionIdentity } from "./provision-identity";

// gmail.com is on the public-provider list (ADR-0068 §1) — these fixtures land
// in a `personal` org, exactly like every ADR-0048 test before the domain rule.
const withOrg: ClerkIdentity = {
  clerkUserId: clerkUserId("u_1"),
  clerkOrgId: clerkOrgId("org_1"),
  email: "ann@gmail.com",
};
const noOrg: ClerkIdentity = {
  clerkUserId: clerkUserId("u_2"),
  clerkOrgId: null,
  email: "bob@gmail.com",
};

// housenumbers.io is NOT on the public-provider list — a `team` org, shared by
// every colleague at that domain (ADR-0068 §1/§3).
const firstAtDomain: ClerkIdentity = {
  clerkUserId: clerkUserId("u_carol"),
  clerkOrgId: null,
  email: "carol@housenumbers.io",
};
const secondAtDomain: ClerkIdentity = {
  clerkUserId: clerkUserId("u_dave"),
  clerkOrgId: null,
  email: "dave@housenumbers.io",
};

function deps() {
  return { identities: new InMemoryIdentityStore(), clerkOrgs: new FakeClerkOrgProvisioner() };
}

describe("provisionIdentity (ADR-0048 JIT provisioning, extended by ADR-0068 domain-keyed org join-or-create)", () => {
  it("mirrors a new identity that already has an active Clerk org, with reports:write + acl:write", async () => {
    const d = deps();
    const r = await provisionIdentity(d, withOrg);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scopes).toEqual(["reports:write", "acl:write"]);
      expect(r.value.orgId).toBeTruthy();
      expect(r.value.folderId).toBeTruthy(); // the org's Root folder
    }
    expect(d.clerkOrgs.calls).toHaveLength(0); // already had an org → no creation
  });

  it("creates a personal Clerk org when the session has none (public-provider address)", async () => {
    const d = deps();
    const r = await provisionIdentity(d, noOrg);

    expect(r.ok).toBe(true);
    expect(d.clerkOrgs.calls).toHaveLength(1);
    expect(d.clerkOrgs.calls[0]?.clerkUserId).toBe("u_2");
    expect(d.clerkOrgs.teamOrgCalls).toHaveLength(0); // never a team-org path
  });

  it("is idempotent — a repeat returns the same identity and does not re-create", async () => {
    const d = deps();
    const a = await provisionIdentity(d, withOrg);
    const b = await provisionIdentity(d, withOrg);

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.value.orgId).toBe(a.value.orgId);
      expect(b.value.folderId).toBe(a.value.folderId);
    }
  });

  it("propagates a Clerk personal-org-creation failure", async () => {
    const failingClerk: ClerkOrgProvisioner = {
      async createPersonalOrg(): Promise<Result<string, AppError>> {
        return err({ kind: "Unexpected", message: "clerk down" });
      },
      async findPersonalOrg(): Promise<Result<string | null, AppError>> {
        return err({ kind: "Unexpected", message: "clerk down" });
      },
      async findTeamOrgByDomain(): Promise<Result<string | null, AppError>> {
        return err({ kind: "Unexpected", message: "clerk down" });
      },
      async createTeamOrg(): Promise<Result<string, AppError>> {
        return err({ kind: "Unexpected", message: "clerk down" });
      },
      async ensureMembership(): Promise<Result<void, AppError>> {
        return err({ kind: "Unexpected", message: "clerk down" });
      },
    };
    const r = await provisionIdentity(
      { identities: new InMemoryIdentityStore(), clerkOrgs: failingClerk },
      noOrg,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("Unexpected");
  });

  it("rejects a malformed email up front (resolveOrgKey validation)", async () => {
    const d = deps();
    const r = await provisionIdentity(d, {
      clerkUserId: clerkUserId("u_bad"),
      clerkOrgId: null,
      email: "not-an-email",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  describe("team-org JIT join-or-create (ADR-0068 §3)", () => {
    it("creates a brand-new team org for the FIRST sign-up at a corporate domain", async () => {
      const d = deps();
      const r = await provisionIdentity(d, firstAtDomain);

      expect(r.ok).toBe(true);
      expect(d.clerkOrgs.teamOrgCalls).toHaveLength(1);
      expect(d.clerkOrgs.teamOrgCalls[0]).toEqual({
        domain: "housenumbers.io",
        createdBy: "u_carol",
      });
      // The first member doesn't need a separate membership call — Clerk
      // auto-assigns the creator as org admin.
      expect(d.clerkOrgs.membershipCalls).toHaveLength(0);
      expect(d.clerkOrgs.calls).toHaveLength(0); // never the personal-org path
    });

    it("joins the EXISTING team org for a second colleague at the same domain — same Org, different User", async () => {
      const d = deps();
      const first = await provisionIdentity(d, firstAtDomain);
      const second = await provisionIdentity(d, secondAtDomain);

      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.value.orgId).toBe(first.value.orgId);
        expect(second.value.folderId).toBe(first.value.folderId); // same Root folder
        expect(second.value.userId).not.toBe(first.value.userId);
      }
      // Exactly one team org created; the second sign-up only joins it.
      expect(d.clerkOrgs.teamOrgCalls).toHaveLength(1);
      expect(d.clerkOrgs.membershipCalls).toEqual([
        { clerkOrgId: "clerk-team-org-housenumbers.io", clerkUserId: "u_dave" },
      ]);
    });

    it("is idempotent for a repeat sign-up at an existing team org (no duplicate membership call)", async () => {
      const d = deps();
      await provisionIdentity(d, firstAtDomain);
      await provisionIdentity(d, secondAtDomain);
      const repeat = await provisionIdentity(d, secondAtDomain);

      expect(repeat.ok).toBe(true);
      // Org resolution (incl. ensureMembership) runs on EVERY no-active-org
      // sign-in — it must, because identity.clerkOrgId is null until Clerk
      // resolution completes. So the count is one per SECOND-USER sign-in
      // (the creator goes through createTeamOrg, not ensureMembership):
      // second's first sign-in + second's repeat = 2. Idempotency lives
      // INSIDE ensureMembership (already-a-member -> no-op), not in skipping
      // the call — no duplicate membership is minted (review #158 L-3).
      expect(d.clerkOrgs.membershipCalls).toHaveLength(2);
    });

    it("propagates a team-org lookup failure", async () => {
      const failing: ClerkOrgProvisioner = {
        async createPersonalOrg(): Promise<Result<string, AppError>> {
          return err({ kind: "Unexpected", message: "unused" });
        },
        async findPersonalOrg(): Promise<Result<string | null, AppError>> {
          return err({ kind: "Unexpected", message: "unused" });
        },
        async findTeamOrgByDomain(): Promise<Result<string | null, AppError>> {
          return err({ kind: "Unexpected", message: "clerk down" });
        },
        async createTeamOrg(): Promise<Result<string, AppError>> {
          return err({ kind: "Unexpected", message: "unused" });
        },
        async ensureMembership(): Promise<Result<void, AppError>> {
          return err({ kind: "Unexpected", message: "unused" });
        },
      };
      const r = await provisionIdentity(
        { identities: new InMemoryIdentityStore(), clerkOrgs: failing },
        firstAtDomain,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });

    it("propagates a team-org creation failure", async () => {
      const d = deps();
      d.clerkOrgs.createTeamOrg = async () => err({ kind: "Unexpected", message: "clerk down" });

      const r = await provisionIdentity(d, firstAtDomain);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });

    it("propagates an ensureMembership failure when joining an existing team org", async () => {
      const d = deps();
      await provisionIdentity(d, firstAtDomain);
      d.clerkOrgs.ensureMembership = async () => err({ kind: "Unexpected", message: "clerk down" });

      const r = await provisionIdentity(d, secondAtDomain);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });
  });
});

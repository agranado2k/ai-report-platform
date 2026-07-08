import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { describe, expect, it } from "vitest";
import { ClerkBackendOrgProvisioner, type ClerkOrgApi } from "./clerk-org-provisioner";

/** A real ClerkAPIResponseError (the adapter's type guard rejects shaped plain
 *  objects), carrying the given error code. */
function clerk422(code: string, message: string): ClerkAPIResponseError {
  return new ClerkAPIResponseError(message, {
    data: [{ code, message }],
    status: 422,
  });
}

/** A Clerk API fake: no existing memberships and a fresh org id, unless overridden. */
function fakeApi(over: Partial<ClerkOrgApi> = {}): ClerkOrgApi {
  return {
    async createOrganization() {
      return { id: "org_new" };
    },
    async getOrganizationMembershipList() {
      return { data: [] };
    },
    async getOrganizationBySlug() {
      return null;
    },
    async createOrganizationMembership() {
      return { id: "orgmem_new" };
    },
    ...over,
  };
}

describe("ClerkBackendOrgProvisioner", () => {
  it("creates a personal org and returns its Clerk id when the user has none", async () => {
    const calls: { name: string; createdBy: string }[] = [];
    const api = fakeApi({
      async createOrganization(p) {
        calls.push(p);
        return { id: "org_123" };
      },
    });

    const r = await new ClerkBackendOrgProvisioner(api).createPersonalOrg(
      "user_abc",
      "ann's workspace",
    );

    expect(r.ok && r.value).toBe("org_123");
    expect(calls).toEqual([{ name: "ann's workspace", createdBy: "user_abc" }]);
  });

  it("reuses the user's existing org instead of creating a duplicate", async () => {
    let created = 0;
    const api = fakeApi({
      async createOrganization() {
        created += 1;
        return { id: "org_should_not_be_used" };
      },
      async getOrganizationMembershipList() {
        return { data: [{ organization: { id: "org_existing", createdAt: 1000 } }] };
      },
    });

    const r = await new ClerkBackendOrgProvisioner(api).createPersonalOrg("user_abc", "w");

    expect(r.ok && r.value).toBe("org_existing");
    expect(created).toBe(0); // idempotent — no new org minted
  });

  it("reuses the OLDEST org when the user belongs to several (stable choice)", async () => {
    const api = fakeApi({
      async getOrganizationMembershipList() {
        return {
          data: [
            { organization: { id: "org_newer", createdAt: 3000 } },
            { organization: { id: "org_oldest", createdAt: 1000 } },
            { organization: { id: "org_mid", createdAt: 2000 } },
          ],
        };
      },
    });

    const r = await new ClerkBackendOrgProvisioner(api).createPersonalOrg("user_abc", "w");

    expect(r.ok && r.value).toBe("org_oldest");
  });

  it("maps a Clerk createOrganization failure to an Unexpected AppError", async () => {
    const api = fakeApi({
      async createOrganization() {
        throw new Error("clerk 500");
      },
    });

    const r = await new ClerkBackendOrgProvisioner(api).createPersonalOrg("user_abc", "w");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("Unexpected");
      expect(r.error.message).toContain("clerk.createOrganization"); // carries the cause
    }
  });

  it("falls through to create when the membership lookup fails (availability over dedupe)", async () => {
    let created = 0;
    const api = fakeApi({
      async getOrganizationMembershipList() {
        throw new Error("clerk list 500");
      },
      async createOrganization() {
        created += 1;
        return { id: "org_fallback" };
      },
    });

    const r = await new ClerkBackendOrgProvisioner(api).createPersonalOrg("user_abc", "w");

    expect(r.ok && r.value).toBe("org_fallback");
    expect(created).toBe(1);
  });

  describe("findPersonalOrg (read-only resolution)", () => {
    it("resolves to null when the user belongs to no org (never creates)", async () => {
      let created = 0;
      const api = fakeApi({
        async createOrganization() {
          created += 1;
          return { id: "org_should_not_be_created" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findPersonalOrg("user_abc");

      expect(r.ok && r.value).toBe(null);
      expect(created).toBe(0); // read-only — must not mint an org
    });

    it("resolves to the user's OLDEST org id (stable choice)", async () => {
      const api = fakeApi({
        async getOrganizationMembershipList() {
          return {
            data: [
              { organization: { id: "org_newer", createdAt: 3000 } },
              { organization: { id: "org_oldest", createdAt: 1000 } },
            ],
          };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findPersonalOrg("user_abc");

      expect(r.ok && r.value).toBe("org_oldest");
    });

    it("maps a membership-lookup failure to an Unexpected AppError", async () => {
      const api = fakeApi({
        async getOrganizationMembershipList() {
          throw new Error("clerk list 500");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findPersonalOrg("user_abc");

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });
  });

  describe("findTeamOrgByDomain (ADR-0068 §3 — JIT join-or-create)", () => {
    it("resolves to null when no team org exists for the domain (never creates)", async () => {
      let created = 0;
      const api = fakeApi({
        async createOrganization() {
          created += 1;
          return { id: "org_should_not_be_created" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findTeamOrgByDomain("housenumbers.io");

      expect(r.ok && r.value).toBe(null);
      expect(created).toBe(0);
    });

    it("resolves the existing team org via the hash-suffixed slug AND a matching domain anchor", async () => {
      const api = fakeApi({
        async getOrganizationBySlug(slug) {
          // dots aren't valid in a Clerk org slug — the adapter maps them to
          // hyphens plus a short domain hash so distinct domains can never
          // collide (review #158 C-1), deterministically, so a later lookup
          // for the same domain always resolves the same slug.
          return slug === "housenumbers-io-132690cd"
            ? { id: "org_team_existing", domain: "housenumbers.io" }
            : null;
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findTeamOrgByDomain("housenumbers.io");

      expect(r.ok && r.value).toBe("org_team_existing");
    });

    it("derives the slug consistently for a two-level-TLD domain (e.g. acme.co.uk)", async () => {
      const api = fakeApi({
        async getOrganizationBySlug(slug) {
          return slug === "acme-co-uk-4b625665"
            ? { id: "org_team_existing", domain: "acme.co.uk" }
            : null;
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findTeamOrgByDomain("acme.co.uk");

      expect(r.ok && r.value).toBe("org_team_existing");
    });

    it("gives colliding lookalike domains DISTINCT slugs (my-company.com vs my.company.com)", async () => {
      // A bare dot→hyphen substitution would map both to "my-company-com" —
      // the hash suffix keeps them apart (review #158 C-1).
      const seen: string[] = [];
      const api = fakeApi({
        async getOrganizationBySlug(slug) {
          seen.push(slug);
          return null;
        },
      });
      const prov = new ClerkBackendOrgProvisioner(api);
      await prov.findTeamOrgByDomain("my-company.com");
      await prov.findTeamOrgByDomain("my.company.com");

      expect(seen).toHaveLength(2);
      expect(seen[0]).not.toBe(seen[1]);
    });

    it("FAILS CLOSED when the resolved org's domain anchor doesn't match (tenant-boundary guard)", async () => {
      const api = fakeApi({
        async getOrganizationBySlug() {
          // Simulates a slug collision / tampered metadata: the slug resolves,
          // but the org anchors a DIFFERENT domain.
          return { id: "org_someone_elses", domain: "acme.co.uk" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findTeamOrgByDomain("acme-co.uk");

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toContain("collision");
    });

    it("FAILS CLOSED on a null anchor (an org predating the anchor scheme)", async () => {
      const api = fakeApi({
        async getOrganizationBySlug() {
          return { id: "org_legacy", domain: null };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findTeamOrgByDomain("housenumbers.io");

      expect(r.ok).toBe(false);
    });

    it("maps a lookup failure to an Unexpected AppError", async () => {
      const api = fakeApi({
        async getOrganizationBySlug() {
          throw new Error("clerk 500");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findTeamOrgByDomain("housenumbers.io");

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });
  });

  describe("createTeamOrg (ADR-0068 §3)", () => {
    it("creates the team org named after the domain, with a Clerk-safe deterministic slug", async () => {
      const calls: {
        name: string;
        slug?: string;
        createdBy: string;
        publicMetadata?: Readonly<Record<string, string>>;
      }[] = [];
      const api = fakeApi({
        async createOrganization(p) {
          calls.push(p);
          return { id: "org_team_new" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).createTeamOrg(
        "housenumbers.io",
        "user_abc",
      );

      expect(r.ok && r.value).toBe("org_team_new");
      expect(calls).toEqual([
        {
          name: "housenumbers.io",
          slug: "housenumbers-io-132690cd",
          createdBy: "user_abc",
          publicMetadata: { domain: "housenumbers.io" },
        },
      ]);
    });

    it("maps a Clerk createOrganization failure to an Unexpected AppError", async () => {
      const api = fakeApi({
        async createOrganization() {
          throw new Error("clerk 500");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).createTeamOrg("acme.co.uk", "user_abc");

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });

    it("recovers from a concurrent create race: re-resolves the org and joins it (no 500)", async () => {
      // Two first sign-ups at a new domain race; the loser's create hits
      // Clerk's unique slug. It must join the winner's org, not 500
      // (review #158 M-1).
      let membershipCalls = 0;
      const api = fakeApi({
        async createOrganization() {
          throw new Error("slug taken");
        },
        async getOrganizationBySlug(slug) {
          return slug === "housenumbers-io-132690cd"
            ? { id: "org_team_winner", domain: "housenumbers.io" }
            : null;
        },
        async createOrganizationMembership() {
          membershipCalls += 1;
          return { id: "orgmem_raced" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).createTeamOrg(
        "housenumbers.io",
        "user_loser",
      );

      expect(r.ok && r.value).toBe("org_team_winner");
      expect(membershipCalls).toBe(1);
    });
  });

  describe("ensureMembership (ADR-0068 §3 — idempotent join)", () => {
    it("creates a membership for a user with no existing membership in that org", async () => {
      const calls: { organizationId: string; userId: string; role: string }[] = [];
      const api = fakeApi({
        async createOrganizationMembership(p) {
          calls.push(p);
          return { id: "orgmem_new" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).ensureMembership("org_team", "user_new");

      expect(r.ok).toBe(true);
      expect(calls).toEqual([
        { organizationId: "org_team", userId: "user_new", role: "org:member" },
      ]);
    });

    it("is idempotent — an already-a-member user is a no-op success, no duplicate call", async () => {
      let created = 0;
      const api = fakeApi({
        async getOrganizationMembershipList() {
          return { data: [{ organization: { id: "org_team", createdAt: 1000 } }] };
        },
        async createOrganizationMembership() {
          created += 1;
          return { id: "orgmem_dup" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).ensureMembership(
        "org_team",
        "user_existing",
      );

      expect(r.ok).toBe(true);
      expect(created).toBe(0);
    });

    it("treats Clerk's already-a-member error as idempotent success (matched by CODE)", async () => {
      const api = fakeApi({
        async createOrganizationMembership() {
          throw clerk422("already_a_member_in_organization", "already a member");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).ensureMembership("org_team", "user_dup");

      expect(r.ok).toBe(true);
    });

    it("does NOT swallow other 422s (e.g. quota exceeded) — review #158 H-2", async () => {
      const api = fakeApi({
        async createOrganizationMembership() {
          throw clerk422("organization_membership_quota_exceeded", "quota exceeded");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).ensureMembership("org_team", "user_new");

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toContain("quota");
    });

    it("maps a Clerk createOrganizationMembership failure to an Unexpected AppError", async () => {
      const api = fakeApi({
        async createOrganizationMembership() {
          throw new Error("clerk 500");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).ensureMembership("org_team", "user_new");

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });
  });
});

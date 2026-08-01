import { describe, expect, it } from "vitest";
import { ClerkBackendOrgProvisioner, type ClerkOrgApi } from "./clerk-org-provisioner";

/** A Clerk API error as the adapter's STRUCTURAL guard sees it: `clerkError:
 *  true` + numeric `status` + an `errors` array — the shape every
 *  `ClerkAPIResponseError` instance carries in both @clerk/backend majors.
 *  Deliberately a plain shaped object, not a class instance: the adapter must
 *  not depend on class identity, because the app and the adapter can resolve
 *  DIFFERENT @clerk/backend copies at runtime (the PR #158 preview-down
 *  incident behind the structural guard). */
function clerk422(code: string, message: string): unknown {
  return {
    clerkError: true,
    status: 422,
    message,
    errors: [{ code, message }],
  };
}

/** A Clerk API fake: no existing memberships, a fresh org id, an empty org
 *  list, and no org resolving by id, unless overridden. */
function fakeApi(over: Partial<ClerkOrgApi> = {}): ClerkOrgApi {
  return {
    async createOrganization() {
      return { id: "org_new" };
    },
    async getOrganizationMembershipList() {
      return { data: [] };
    },
    async getOrganization() {
      return null;
    },
    async listOrganizations() {
      return { data: [], totalCount: 0 };
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

  describe("verifyOrgAnchor (ADR-0074 — tenant-boundary guard on a DB-index hit)", () => {
    it("passes when the org's publicMetadata.domain anchor matches exactly", async () => {
      const api = fakeApi({
        async getOrganization(id) {
          return id === "org_hn"
            ? { id: "org_hn", name: "House Numbers", domainAnchor: "housenumbers.io" }
            : null;
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).verifyOrgAnchor(
        "org_hn",
        "housenumbers.io",
      );

      expect(r.ok).toBe(true);
    });

    it("matches case-insensitively on the requested domain (anchors are stored lowercased)", async () => {
      const api = fakeApi({
        async getOrganization() {
          return { id: "org_hn", name: "House Numbers", domainAnchor: "housenumbers.io" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).verifyOrgAnchor(
        "org_hn",
        "HouseNumbers.IO",
      );

      expect(r.ok).toBe(true);
    });

    it("FAILS CLOSED when the anchor names a different domain (tenant-boundary crossing)", async () => {
      const api = fakeApi({
        async getOrganization() {
          return { id: "org_other", name: "Acme", domainAnchor: "acme.co.uk" };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).verifyOrgAnchor(
        "org_other",
        "acme-co.uk",
      );

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toContain("anchor");
    });

    it("FAILS CLOSED on a null anchor — a DB-indexed org must carry its anchor", async () => {
      const api = fakeApi({
        async getOrganization() {
          return { id: "org_legacy", name: "Legacy", domainAnchor: null };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).verifyOrgAnchor(
        "org_legacy",
        "housenumbers.io",
      );

      expect(r.ok).toBe(false);
    });

    it("FAILS CLOSED when the org no longer exists in Clerk (index/Clerk drift)", async () => {
      const api = fakeApi(); // getOrganization → null

      const r = await new ClerkBackendOrgProvisioner(api).verifyOrgAnchor(
        "org_gone",
        "housenumbers.io",
      );

      expect(r.ok).toBe(false);
    });

    it("maps a lookup failure to an Unexpected AppError", async () => {
      const api = fakeApi({
        async getOrganization() {
          throw new Error("clerk 500");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).verifyOrgAnchor(
        "org_hn",
        "housenumbers.io",
      );

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });
  });

  describe("findOrgByAnchorScan (ADR-0074 — DB-index-miss adoption path)", () => {
    it("finds an existing unmirrored org by its publicMetadata.domain anchor", async () => {
      const api = fakeApi({
        async listOrganizations() {
          return {
            data: [
              { id: "org_a", name: "A", domainAnchor: null },
              { id: "org_hn", name: "House Numbers", domainAnchor: "housenumbers.io" },
            ],
            totalCount: 2,
          };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findOrgByAnchorScan("housenumbers.io");

      expect(r.ok && r.value).toEqual({ clerkOrgId: "org_hn", name: "House Numbers" });
    });

    it("resolves to null when no org anchors the domain (never adopts a null anchor)", async () => {
      const api = fakeApi({
        async listOrganizations() {
          return {
            data: [
              { id: "org_a", name: "A", domainAnchor: null },
              { id: "org_b", name: "B", domainAnchor: "other.example" },
            ],
            totalCount: 2,
          };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findOrgByAnchorScan("housenumbers.io");

      expect(r.ok && r.value).toBe(null);
    });

    it("paginates until the match (page size 100)", async () => {
      const pages: { limit: number; offset: number }[] = [];
      const api = fakeApi({
        async listOrganizations(p) {
          pages.push(p);
          const data =
            p.offset === 0
              ? Array.from({ length: 100 }, (_, i) => ({
                  id: `org_${i}`,
                  name: `Org ${i}`,
                  domainAnchor: null,
                }))
              : [{ id: "org_hn", name: "House Numbers", domainAnchor: "housenumbers.io" }];
          return { data, totalCount: 101 };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findOrgByAnchorScan("housenumbers.io");

      expect(r.ok && r.value?.clerkOrgId).toBe("org_hn");
      expect(pages).toEqual([
        { limit: 100, offset: 0 },
        { limit: 100, offset: 100 },
      ]);
    });

    it("stops at the 200-org scan bound (the ADR-0074 scalability cap) and resolves null", async () => {
      let calls = 0;
      const api = fakeApi({
        async listOrganizations(p) {
          calls += 1;
          return {
            data: Array.from({ length: p.limit }, (_, i) => ({
              id: `org_${p.offset + i}`,
              name: "filler",
              domainAnchor: null,
            })),
            totalCount: 10_000,
          };
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findOrgByAnchorScan("housenumbers.io");

      expect(r.ok && r.value).toBe(null);
      expect(calls).toBe(2); // 2 × 100 = the 200-org bound
    });

    it("maps a list failure to an Unexpected AppError", async () => {
      const api = fakeApi({
        async listOrganizations() {
          throw new Error("clerk 500");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).findOrgByAnchorScan("housenumbers.io");

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
    });
  });

  describe("createTeamOrg (ADR-0074 — slug-less, anchor-stamped)", () => {
    it("creates the team org named after the domain with a metadata anchor and NO slug", async () => {
      const calls: {
        name: string;
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
        "HouseNumbers.IO",
        "user_abc",
      );

      expect(r.ok && r.value).toBe("org_team_new");
      // No `slug` key at all — the prod instance auto-generates slugs
      // (slug_disabled: true), and nothing keys on them anymore (ADR-0074).
      expect(calls).toEqual([
        {
          name: "housenumbers.io",
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

    it("maps the member-cap quota error to the typed PlanLimitExceeded (ADR-0074)", async () => {
      // The webhook acks a cap with 200 + alert instead of retrying (Svix
      // retries can't fix a plan cap) — that branch keys on THIS kind.
      const api = fakeApi({
        async createOrganizationMembership() {
          throw clerk422("organization_membership_quota_exceeded", "quota exceeded");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).ensureMembership("org_team", "user_21st");

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe("PlanLimitExceeded");
        expect(r.error.message).toContain("quota");
      }
    });

    it("does NOT swallow other 422s (e.g. invalid role) — review #158 H-2", async () => {
      const api = fakeApi({
        async createOrganizationMembership() {
          throw clerk422("invalid_role", "role does not exist");
        },
      });

      const r = await new ClerkBackendOrgProvisioner(api).ensureMembership("org_team", "user_new");

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Unexpected");
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

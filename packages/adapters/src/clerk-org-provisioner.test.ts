import { describe, expect, it } from "vitest";
import { ClerkBackendOrgProvisioner, type ClerkOrgApi } from "./clerk-org-provisioner";

/** A Clerk API fake: no existing memberships and a fresh org id, unless overridden. */
function fakeApi(over: Partial<ClerkOrgApi> = {}): ClerkOrgApi {
  return {
    async createOrganization() {
      return { id: "org_new" };
    },
    async getOrganizationMembershipList() {
      return { data: [] };
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
});

import { describe, expect, it } from "vitest";
import { ClerkBackendOrgProvisioner, type ClerkOrgApi } from "./clerk-org-provisioner";

describe("ClerkBackendOrgProvisioner", () => {
  it("creates a personal org and returns its Clerk id", async () => {
    const calls: { name: string; createdBy: string }[] = [];
    const orgs: ClerkOrgApi = {
      async createOrganization(p) {
        calls.push(p);
        return { id: "org_123" };
      },
    };
    const r = await new ClerkBackendOrgProvisioner(orgs).createPersonalOrg(
      "user_abc",
      "ann's workspace",
    );

    expect(r.ok && r.value).toBe("org_123");
    expect(calls).toEqual([{ name: "ann's workspace", createdBy: "user_abc" }]);
  });

  it("maps a Clerk API failure to an Unexpected AppError", async () => {
    const orgs: ClerkOrgApi = {
      async createOrganization() {
        throw new Error("clerk 500");
      },
    };
    const r = await new ClerkBackendOrgProvisioner(orgs).createPersonalOrg("user_abc", "w");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("Unexpected");
      expect(r.error.message).toContain("clerk.createOrganization"); // carries the cause
    }
  });
});

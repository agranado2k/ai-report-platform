import { type AppError, err, type Result } from "arp-domain";
import { describe, expect, it } from "vitest";
import type { ClerkIdentity, ClerkOrgProvisioner } from "../ports";
import { FakeClerkOrgProvisioner, InMemoryIdentityStore } from "../testing/in-memory";
import { provisionIdentity } from "./provision-identity";

const withOrg: ClerkIdentity = {
  clerkUserId: "u_1",
  clerkOrgId: "org_1",
  email: "ann@example.com",
};
const noOrg: ClerkIdentity = { clerkUserId: "u_2", clerkOrgId: null, email: "bob@example.com" };

function deps() {
  return { identities: new InMemoryIdentityStore(), clerkOrgs: new FakeClerkOrgProvisioner() };
}

describe("provisionIdentity (ADR-0048 Clerk JIT personal-org)", () => {
  it("mirrors a new identity that already has an active Clerk org, with reports:write", async () => {
    const d = deps();
    const r = await provisionIdentity(d, withOrg);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scopes).toEqual(["reports:write"]);
      expect(r.value.orgId).toBeTruthy();
      expect(r.value.folderId).toBeTruthy(); // the org's Root folder
    }
    expect(d.clerkOrgs.calls).toHaveLength(0); // already had an org → no creation
  });

  it("creates a personal Clerk org when the session has none, then mirrors", async () => {
    const d = deps();
    const r = await provisionIdentity(d, noOrg);

    expect(r.ok).toBe(true);
    expect(d.clerkOrgs.calls).toHaveLength(1);
    expect(d.clerkOrgs.calls[0]?.clerkUserId).toBe("u_2");
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

  it("propagates a Clerk org-creation failure", async () => {
    const failingClerk: ClerkOrgProvisioner = {
      async createPersonalOrg(): Promise<Result<string, AppError>> {
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
});

import { describe, expect, it } from "vitest";
import { InMemoryApiKeyStore, InMemoryIdentityStore } from "../testing/in-memory";
import { handleUserDeleted } from "./handle-user-deleted";

const CLERK_USER = "user_2abcCLERK";
const CLERK_ORG = "org_2abcCLERK";

async function seed() {
  const identities = new InMemoryIdentityStore();
  const apiKeys = new InMemoryApiKeyStore();
  const id = await identities.createPersonalIdentity({
    clerkUserId: CLERK_USER,
    clerkOrgId: CLERK_ORG,
    email: "a@example.com",
    orgName: "A",
  });
  if (!id.ok) throw new Error("seed failed");
  return { identities, apiKeys, userId: id.value.userId, orgId: id.value.orgId };
}

describe("handleUserDeleted (Clerk user.deleted mirror, ADR-0054)", () => {
  it("soft-deletes the user and revokes all their API keys", async () => {
    const { identities, apiKeys, userId, orgId } = await seed();
    await apiKeys.create({ actingUserId: userId, issuedInOrgId: orgId, name: "k1", scopes: [] });
    await apiKeys.create({ actingUserId: userId, issuedInOrgId: orgId, name: "k2", scopes: [] });

    const r = await handleUserDeleted({ identities, apiKeys }, { clerkUserId: CLERK_USER });
    expect(r.ok && r.value).toEqual({ softDeleted: true, keysRevoked: 2 });

    // The user no longer resolves as an actor.
    const found = await identities.findByClerk(CLERK_USER, CLERK_ORG);
    expect(found.ok && found.value).toBeNull();
    // Every key is revoked.
    const keys = await apiKeys.listForUser(userId);
    expect(keys.ok && keys.value.every((k) => k.revokedAt !== null)).toBe(true);
  });

  it("blocks re-provisioning a deleted user — deletion is terminal", async () => {
    const { identities, apiKeys } = await seed();
    await handleUserDeleted({ identities, apiKeys }, { clerkUserId: CLERK_USER });

    const reprovision = await identities.createPersonalIdentity({
      clerkUserId: CLERK_USER,
      clerkOrgId: CLERK_ORG,
      email: "a@example.com",
      orgName: "A",
    });
    expect(reprovision.ok).toBe(false);
  });

  it("is idempotent for an unknown id (no-op success)", async () => {
    const identities = new InMemoryIdentityStore();
    const apiKeys = new InMemoryApiKeyStore();
    const r = await handleUserDeleted({ identities, apiKeys }, { clerkUserId: "user_ghost" });
    expect(r.ok && r.value).toEqual({ softDeleted: false, keysRevoked: 0 });
  });

  it("is idempotent on replay — second delete is a no-op (no double cascade)", async () => {
    const { identities, apiKeys, userId, orgId } = await seed();
    await apiKeys.create({ actingUserId: userId, issuedInOrgId: orgId, name: "k1", scopes: [] });
    await handleUserDeleted({ identities, apiKeys }, { clerkUserId: CLERK_USER });

    const second = await handleUserDeleted({ identities, apiKeys }, { clerkUserId: CLERK_USER });
    expect(second.ok && second.value).toEqual({ softDeleted: false, keysRevoked: 0 });
  });
});

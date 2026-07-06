import { orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryApiKeyStore } from "../testing/in-memory";
import { revokeApiKey } from "./revoke-api-key";

const alice = userId("00000000-0000-7000-8000-0000000000a1");
const bob = userId("00000000-0000-7000-8000-0000000000b1");
const orgA = orgId("00000000-0000-7000-8000-0000000000c1");

describe("revokeApiKey use case", () => {
  it("revokes a key the acting user owns", async () => {
    const apiKeys = new InMemoryApiKeyStore();
    const created = await apiKeys.create({
      actingUserId: alice,
      issuedInOrgId: orgA,
      name: "k",
      scopes: [],
    });
    if (!created.ok) throw new Error("setup failed");

    const r = await revokeApiKey({ apiKeys }, { userId: alice }, { id: created.value.summary.id });
    expect(r.ok).toBe(true);

    const list = await apiKeys.listForUser(alice);
    expect(list.ok && list.value[0]?.revokedAt).not.toBeNull();
  });

  it("is a no-op (not an error) revoking a key that isn't the acting user's", async () => {
    const apiKeys = new InMemoryApiKeyStore();
    const created = await apiKeys.create({
      actingUserId: alice,
      issuedInOrgId: orgA,
      name: "k",
      scopes: [],
    });
    if (!created.ok) throw new Error("setup failed");

    const r = await revokeApiKey({ apiKeys }, { userId: bob }, { id: created.value.summary.id });
    expect(r.ok).toBe(true); // the store's own idempotent no-op semantics

    const list = await apiKeys.listForUser(alice);
    expect(list.ok && list.value[0]?.revokedAt).toBeNull(); // untouched
  });
});

import { orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryApiKeyStore } from "../testing/in-memory";
import { listApiKeys } from "./list-api-keys";

const alice = userId("00000000-0000-7000-8000-0000000000a1");
const bob = userId("00000000-0000-7000-8000-0000000000b1");
const orgA = orgId("00000000-0000-7000-8000-0000000000c1");
const orgB = orgId("00000000-0000-7000-8000-0000000000c2");

describe("listApiKeys use case", () => {
  it("lists only the acting user's keys, newest first", async () => {
    const apiKeys = new InMemoryApiKeyStore();
    await apiKeys.create({ actingUserId: alice, issuedInOrgId: orgA, name: "first", scopes: [] });
    await apiKeys.create({ actingUserId: alice, issuedInOrgId: orgA, name: "second", scopes: [] });
    await apiKeys.create({ actingUserId: bob, issuedInOrgId: orgB, name: "bob's key", scopes: [] });

    const r = await listApiKeys({ apiKeys }, { userId: alice });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((k) => k.name)).toEqual(["second", "first"]);
  });

  it("returns an empty list for a user with no keys", async () => {
    const apiKeys = new InMemoryApiKeyStore();
    const r = await listApiKeys({ apiKeys }, { userId: alice });
    expect(r.ok && r.value).toEqual([]);
  });
});

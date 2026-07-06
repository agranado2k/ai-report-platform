import { orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { InMemoryApiKeyStore } from "../testing/in-memory";
import { createApiKey } from "./create-api-key";

const alice = userId("00000000-0000-7000-8000-0000000000a1");
const orgA = orgId("00000000-0000-7000-8000-0000000000c1");

describe("createApiKey use case", () => {
  it("mints a key with the default reports:write scope", async () => {
    const apiKeys = new InMemoryApiKeyStore();
    const r = await createApiKey(
      { apiKeys },
      { userId: alice, orgId: orgA },
      { name: "ci-uploader" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.summary.name).toBe("ci-uploader");
    expect(r.value.summary.scopes).toEqual(["reports:write"]);
    expect(r.value.token).toMatch(/^arp_/);
  });

  it("rejects a blank name with ValidationError (422) instead of minting a nameless key", async () => {
    const apiKeys = new InMemoryApiKeyStore();
    const r = await createApiKey({ apiKeys }, { userId: alice, orgId: orgA }, { name: "   " });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    expect(apiKeys.keys).toHaveLength(0);
  });

  it("trims the name before minting", async () => {
    const apiKeys = new InMemoryApiKeyStore();
    const r = await createApiKey(
      { apiKeys },
      { userId: alice, orgId: orgA },
      { name: "  spaced  " },
    );
    expect(r.ok && r.value.summary.name).toBe("spaced");
  });

  it("honours an explicit scopes override", async () => {
    const apiKeys = new InMemoryApiKeyStore();
    const r = await createApiKey(
      { apiKeys },
      { userId: alice, orgId: orgA },
      { name: "readonly", scopes: ["reports:read"] },
    );
    expect(r.ok && r.value.summary.scopes).toEqual(["reports:read"]);
  });
});

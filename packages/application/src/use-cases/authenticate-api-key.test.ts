import { type AppError, err, folderId, ok, orgId, type Result, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import type { ApiKeyPrincipal, ApiKeyStore } from "../ports";
import { authenticateApiKey } from "./authenticate-api-key";

const PRINCIPAL: ApiKeyPrincipal = {
  userId: userId("00000000-0000-4000-8000-000000000002"),
  orgId: orgId("00000000-0000-4000-8000-000000000001"),
  rootFolderId: folderId("00000000-0000-4000-8000-000000000003"),
  scopes: ["reports:write"],
};

/** A minimal ApiKeyStore whose verify() returns a fixed result; other ops are unused here. */
function storeWhereVerify(result: Result<ApiKeyPrincipal | null, AppError>): ApiKeyStore {
  return {
    verify: async () => result,
    create: async () => {
      throw new Error("unused");
    },
    listForUser: async () => {
      throw new Error("unused");
    },
    revoke: async () => {
      throw new Error("unused");
    },
    revokeAllForUser: async () => {
      throw new Error("unused");
    },
  };
}

describe("authenticateApiKey (ADR-0008)", () => {
  it("maps a resolved key principal onto an UploadActor (Root folder + key scopes)", async () => {
    const r = await authenticateApiKey({ apiKeys: storeWhereVerify(ok(PRINCIPAL)) }, "arp_x");
    expect(r.ok).toBe(true);
    if (r.ok && r.value) {
      expect(r.value.userId).toBe(PRINCIPAL.userId);
      expect(r.value.orgId).toBe(PRINCIPAL.orgId);
      expect(r.value.folderId).toBe(PRINCIPAL.rootFolderId); // org Root = Phase-1 write default
      expect(r.value.scopes).toEqual(["reports:write"]); // from the key row, not hardcoded
    } else {
      expect.fail("expected an actor");
    }
  });

  it("returns ok(null) when the token matches no live key", async () => {
    const r = await authenticateApiKey({ apiKeys: storeWhereVerify(ok(null)) }, "arp_x");
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBeNull();
  });

  it("propagates a store failure", async () => {
    const r = await authenticateApiKey(
      { apiKeys: storeWhereVerify(err({ kind: "Unexpected", message: "db down" })) },
      "arp_x",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("Unexpected");
  });
});

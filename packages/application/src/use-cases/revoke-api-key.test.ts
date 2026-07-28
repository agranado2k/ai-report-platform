import { orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryApiKeyStore,
  InMemoryAuditLogger,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { revokeApiKey } from "./revoke-api-key";

const alice = userId("00000000-0000-7000-8000-0000000000a1");
const bob = userId("00000000-0000-7000-8000-0000000000b1");
const orgA = orgId("00000000-0000-7000-8000-0000000000c1");
const orgB = orgId("00000000-0000-7000-8000-0000000000c2");

function makeDeps() {
  return {
    apiKeys: new InMemoryApiKeyStore(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
  };
}

describe("revokeApiKey use case", () => {
  it("revokes a key the acting user owns", async () => {
    const deps = makeDeps();
    const created = await deps.apiKeys.create({
      actingUserId: alice,
      issuedInOrgId: orgA,
      name: "k",
      scopes: [],
    });
    if (!created.ok) throw new Error("setup failed");

    const r = await revokeApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { id: created.value.summary.id },
    );
    expect(r.ok).toBe(true);

    const list = await deps.apiKeys.listForUser(alice);
    expect(list.ok && list.value[0]?.revokedAt).not.toBeNull();

    expect(deps.audit.recorded()).toContainEqual({
      action: "api_key.revoked",
      orgId: orgA,
      actorUserId: alice,
      targetType: "api_key",
      targetId: created.value.summary.id,
    });
  });

  it("is a no-op (not an error) revoking a key that isn't the acting user's", async () => {
    const deps = makeDeps();
    const created = await deps.apiKeys.create({
      actingUserId: alice,
      issuedInOrgId: orgA,
      name: "k",
      scopes: [],
    });
    if (!created.ok) throw new Error("setup failed");

    const r = await revokeApiKey(
      deps,
      { userId: bob, orgId: orgB },
      { id: created.value.summary.id },
    );
    expect(r.ok).toBe(true); // the store's own idempotent no-op semantics

    const list = await deps.apiKeys.listForUser(alice);
    expect(list.ok && list.value[0]?.revokedAt).toBeNull(); // untouched
  });
});

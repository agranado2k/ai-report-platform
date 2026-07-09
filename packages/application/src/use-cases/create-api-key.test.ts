import { orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryApiKeyStore,
  InMemoryAuditLogger,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { createApiKey } from "./create-api-key";

const alice = userId("00000000-0000-7000-8000-0000000000a1");
const orgA = orgId("00000000-0000-7000-8000-0000000000c1");

function makeDeps() {
  return {
    apiKeys: new InMemoryApiKeyStore(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
  };
}

describe("createApiKey use case", () => {
  it("mints a key with the default reports:write scope", async () => {
    const deps = makeDeps();
    const r = await createApiKey(deps, { userId: alice, orgId: orgA }, { name: "ci-uploader" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.summary.name).toBe("ci-uploader");
    expect(r.value.summary.scopes).toEqual(["reports:write"]);
    expect(r.value.token).toMatch(/^arp_/);
  });

  it("rejects a blank name with ValidationError (422) instead of minting a nameless key", async () => {
    const deps = makeDeps();
    const r = await createApiKey(deps, { userId: alice, orgId: orgA }, { name: "   " });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    expect(deps.apiKeys.keys).toHaveLength(0);
  });

  it("trims the name before minting", async () => {
    const deps = makeDeps();
    const r = await createApiKey(deps, { userId: alice, orgId: orgA }, { name: "  spaced  " });
    expect(r.ok && r.value.summary.name).toBe("spaced");
  });

  it("honours an explicit scopes override", async () => {
    const deps = makeDeps();
    const r = await createApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { name: "readonly", scopes: ["reports:read"] },
    );
    expect(r.ok && r.value.summary.scopes).toEqual(["reports:read"]);
  });

  it("records an api_key.created audit row without the plaintext secret (ADR-0070)", async () => {
    const deps = makeDeps();
    const r = await createApiKey(deps, { userId: alice, orgId: orgA }, { name: "ci-uploader" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const recorded = deps.audit.recorded();
    expect(recorded).toContainEqual({
      action: "api_key.created",
      orgId: orgA,
      actorUserId: alice,
      targetType: "api_key",
      targetId: r.value.summary.id,
      meta: {},
    });
    // No plaintext token / secret anywhere in the recorded entries.
    expect(JSON.stringify(recorded)).not.toContain(r.value.token);
  });
});

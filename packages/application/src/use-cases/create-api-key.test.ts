import { orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryApiKeyStore,
  InMemoryAuditLogger,
  idempotencyTestDeps,
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
    ...idempotencyTestDeps(),
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

  it("honours an explicit scopes override within the issuable set", async () => {
    const deps = makeDeps();
    const r = await createApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { name: "sharing-agent", scopes: ["reports:write", "acl:write"] },
    );
    expect(r.ok && r.value.summary.scopes).toEqual(["reports:write", "acl:write"]);
  });

  it("rejects an unknown scope with ValidationError (422) — nothing is minted", async () => {
    const deps = makeDeps();
    const r = await createApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { name: "bad", scopes: ["reports:write", "reports:admin"] },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    expect(deps.apiKeys.keys).toHaveLength(0);
  });

  it("rejects a non-issuable (unenforced) scope even though ADR-0016 defines it", async () => {
    const deps = makeDeps();
    const r = await createApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { name: "readonly", scopes: ["reports:read"] },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    expect(deps.apiKeys.keys).toHaveLength(0);
  });

  it("rejects an empty scope selection with ValidationError (422)", async () => {
    const deps = makeDeps();
    const r = await createApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { name: "none", scopes: [] },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    expect(deps.apiKeys.keys).toHaveLength(0);
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

describe("createApiKey idempotency (ADR-0039 — explicit key only)", () => {
  it("with NO explicit key, two same-named mints both execute (the derived fallback is deliberately not applied)", async () => {
    const deps = makeDeps();
    const first = await createApiKey(deps, { userId: alice, orgId: orgA }, { name: "ci" });
    const second = await createApiKey(deps, { userId: alice, orgId: orgA }, { name: "ci" });
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(first.value.token).not.toBeNull();
    expect(second.value.token).not.toBeNull();
    expect(second.value.summary.id).not.toBe(first.value.summary.id);
  });

  it("the fingerprint distinguishes scope sets: same name + same key with different scopes is a reuse error, and without a key two mints coexist", async () => {
    const deps = makeDeps();
    const first = await createApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { name: "ci", scopes: ["reports:write"], idempotencyKey: "mint-1" },
    );
    expect(first.ok).toBe(true);
    // Same explicit key, different scopes → the (name, scopes) fingerprint
    // mismatch is surfaced, never a silent replay of the narrower key.
    const reused = await createApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { name: "ci", scopes: ["reports:write", "acl:write"], idempotencyKey: "mint-1" },
    );
    expect(!reused.ok && reused.error.kind).toBe("IdempotencyKeyReuseDifferentBody");
    // Without an idempotency key the second same-named mint simply coexists,
    // each carrying its own scopes.
    const second = await createApiKey(
      deps,
      { userId: alice, orgId: orgA },
      { name: "ci", scopes: ["reports:write", "acl:write"] },
    );
    expect(second.ok && second.value.summary.scopes).toEqual(["reports:write", "acl:write"]);
    const list = await deps.apiKeys.listForUser(alice);
    expect(list.ok && list.value.length).toBe(2);
  });

  it("with an explicit key, a retry replays the summary with token: null — the secret is never persisted", async () => {
    const deps = makeDeps();
    const input = { name: "mcp", idempotencyKey: "mint-1" };
    const first = await createApiKey(deps, { userId: alice, orgId: orgA }, input);
    const second = await createApiKey(deps, { userId: alice, orgId: orgA }, input);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(first.value.token).not.toBeNull(); // fresh mint shows the secret once
    expect(second.value.token).toBeNull(); // replay can never re-display it
    expect(second.value.summary.id).toBe(first.value.summary.id);
    // No second key was minted.
    const list = await deps.apiKeys.listForUser(alice);
    expect(list.ok && list.value.length).toBe(1);
  });
});

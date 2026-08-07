import { orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryApiKeyStore,
  InMemoryAuditLogger,
  idempotencyTestDeps,
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
    ...idempotencyTestDeps(),
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

describe("revokeApiKey idempotency (ADR-0039)", () => {
  it("re-applies on an identical KEYLESS retry — no derived-key replay (#233)", async () => {
    const deps = makeDeps();
    const created = await deps.apiKeys.create({
      actingUserId: alice,
      issuedInOrgId: orgA,
      name: "k",
      scopes: ["reports:write"],
    });
    if (!created.ok) throw new Error("seed failed");
    const input = { id: created.value.summary.id };
    const first = await revokeApiKey(deps, { userId: alice, orgId: orgA }, input);
    const second = await revokeApiKey(deps, { userId: alice, orgId: orgA }, input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // NOTE — why this route has no A -> B -> A sibling. A revoked key is never
    // un-revoked, so there is no second state to return to and no observable
    // difference between "re-applied" and "replayed" in the store. #233's
    // acceptance is satisfied here by its FIRST clause ("either skips the
    // derived-key fallback or is proven by a round-trip"): this use case skips
    // it, and this count is the evidence that the retry really executes.
    // A separate call-counting test was written and then removed — it measured
    // the same thing at a different port (the store's revoke and the audit row
    // are in one uow.run with no branch between them), so it was duplication
    // wearing the costume of extra coverage.
    // #233: was 1, when the derived-key fallback replayed instead of
    // re-applying. The retry now really runs — same end state (these are
    // naturally idempotent), one more audit row. An explicit
    // Idempotency-Key still claims and replays exactly as before.
    expect(deps.audit.recorded().length).toBe(2);
  });
});

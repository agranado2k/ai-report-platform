// Integration tests for DrizzleApiKeyRepository against real Postgres (pglite),
// reusing the #52 harness. seedIdentity() supplies the Org / User / Root folder
// an api_keys row references; the repo mints + verifies real `arp_` tokens.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleApiKeyRepository } from "./api-key-repository";
import { ApiKeyService } from "./services/api-key";
import { makeTestDb, type SeededIdentity, seedIdentity, type TestDb } from "./testing/pglite";

describe("DrizzleApiKeyRepository (pglite integration)", () => {
  let tdb: TestDb;
  let seed: SeededIdentity;
  let repo: DrizzleApiKeyRepository;

  beforeEach(async () => {
    tdb = await makeTestDb();
    seed = await seedIdentity(tdb.ctx);
    repo = new DrizzleApiKeyRepository(
      tdb.ctx,
      new ApiKeyService({ pepper: "itest-pepper", label: "test" }),
    );
  });
  afterEach(() => tdb.close());

  const mint = (name = "ci") =>
    repo.create({
      actingUserId: seed.userId,
      issuedInOrgId: seed.orgId,
      name,
      scopes: ["reports:write"],
    });

  it("verify returns null when no key matches the presented token", async () => {
    const r = await repo.verify("arp_nonexistent_token_value");
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBeNull();
  });

  it("create → verify resolves the full principal (user, org, root folder, scopes)", async () => {
    const created = await mint();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.token.startsWith("arp_")).toBe(true);

    const v = await repo.verify(created.value.token);
    expect(v.ok).toBe(true);
    if (v.ok && v.value) {
      expect(v.value.userId).toBe(seed.userId);
      expect(v.value.orgId).toBe(seed.orgId);
      expect(v.value.rootFolderId).toBe(seed.folderId);
      expect(v.value.scopes).toEqual(["reports:write"]);
    } else {
      expect.fail("expected a resolved principal");
    }
  });

  it("verify bumps last_used_at on a hit", async () => {
    const created = await mint();
    if (!created.ok) return;

    const before = await repo.listForUser(seed.userId);
    expect(before.ok && before.value[0]?.lastUsedAt).toBeNull();

    await repo.verify(created.value.token);

    const after = await repo.listForUser(seed.userId);
    expect(after.ok && typeof after.value[0]?.lastUsedAt).toBe("number");
  });

  it("revoke makes verify return null and marks the summary revoked", async () => {
    const created = await mint();
    if (!created.ok) return;

    const rev = await repo.revoke(created.value.summary.id, seed.userId);
    expect(rev.ok).toBe(true);

    const v = await repo.verify(created.value.token);
    expect(v.ok && v.value).toBeNull();

    const list = await repo.listForUser(seed.userId);
    expect(list.ok && typeof list.value[0]?.revokedAt).toBe("number");
  });

  it("listForUser returns the user's keys (newest first) without secrets", async () => {
    await mint("first");
    await mint("second");

    const list = await repo.listForUser(seed.userId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value).toHaveLength(2);
    // No secret/hash leaks in the summary — only the non-secret prefix.
    for (const s of list.value) {
      expect(s).not.toHaveProperty("token");
      expect(s).not.toHaveProperty("keyHash");
      expect(s.keyPrefix.startsWith("arp_")).toBe(true);
    }
  });

  it("verify resolves the correct key when several exist", async () => {
    const a = await mint("a");
    const b = await mint("b");
    if (!a.ok || !b.ok) return;

    const va = await repo.verify(a.value.token);
    const vb = await repo.verify(b.value.token);
    expect(va.ok && va.value?.scopes).toEqual(["reports:write"]);
    expect(vb.ok && vb.value?.scopes).toEqual(["reports:write"]);
    // A token whose secret doesn't match any stored hash resolves to nothing.
    const miss = await repo.verify("arp_definitely_not_a_real_secret_value_here");
    expect(miss.ok && miss.value).toBeNull();
  });
});

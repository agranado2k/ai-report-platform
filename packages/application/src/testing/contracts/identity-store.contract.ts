// Shared IdentityStore contract (ADR-0048 JIT mirroring, ADR-0054 terminal
// deletion, ADR-0060 §2 email matching, ADR-0063 author display, ADR-0068 team
// orgs; ADR-0046 two-tier testing). Run this ONE suite against both the
// InMemoryIdentityStore fake
// (packages/application/src/testing/contracts/identity-store.contract.test.ts)
// and DrizzleIdentityStore on pglite
// (packages/adapters/src/identity-store.contract.test.ts).
//
// Every fixture is created through the port itself (createIdentity), so the
// harness carries no implementation knowledge — it only supplies the store.
// All nine port methods are covered.
import { type UserId, userId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IdentityStore } from "../../ports";

export interface IdentityStoreContractHarness {
  readonly store: IdentityStore;
  /** Release whatever the harness allocated; a no-op for the in-memory fake. */
  teardown(): Promise<void>;
}

const CU = "clerk_user_1";
const CO = "clerk_org_1";

/** A UUID-shaped id no mirrored user has (the real store's uuid column
 *  requires valid UUID text even for a miss). */
const UNKNOWN_USER_ID: UserId = userId("00000000-0000-7000-8000-00000000dead");

/**
 * Runs the IdentityStore contract against `setup()`'s implementation. `label`
 * distinguishes the two runs in test output (e.g. "in-memory" vs
 * "drizzle+pglite"). `setup()` is called fresh before EVERY test.
 */
export function describeIdentityStoreContract(
  label: string,
  setup: () => Promise<IdentityStoreContractHarness>,
): void {
  describe(`IdentityStore contract (${label})`, () => {
    let h: IdentityStoreContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    const mirror = (overrides: Partial<Parameters<IdentityStore["createIdentity"]>[0]> = {}) =>
      h.store.createIdentity({
        clerkUserId: CU,
        clerkOrgId: CO,
        email: "ann@example.com",
        displayName: "Ann Anderson",
        orgName: "ann's workspace",
        kind: "personal",
        ...overrides,
      });

    // ── findByClerk / createIdentity (ADR-0048) ────────────────────────────
    it("findByClerk returns null when the identity isn't mirrored yet", async () => {
      const r = await h.store.findByClerk(CU, CO);
      expect(r.ok && r.value).toBeNull();
    });

    it("createIdentity mirrors User + Org + Root folder; findByClerk returns the same trio", async () => {
      const created = await mirror();
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const found = await h.store.findByClerk(CU, CO);
      expect(found.ok && found.value).toEqual(created.value);
    });

    it("createIdentity is idempotent — a re-provision returns the same ids", async () => {
      const a = await mirror();
      const b = await mirror();
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) expect(b.value).toEqual(a.value);
    });

    it("a second colleague joining the SAME team org gets the same Org + Root folder but a distinct User (ADR-0068 §3)", async () => {
      const alice = await mirror({
        clerkUserId: "clerk_user_alice",
        clerkOrgId: "clerk_org_team",
        email: "alice@housenumbers.io",
        orgName: "housenumbers.io",
        kind: "team",
      });
      const bob = await mirror({
        clerkUserId: "clerk_user_bob",
        clerkOrgId: "clerk_org_team",
        email: "bob@housenumbers.io",
        displayName: "Bob Baxter",
        orgName: "housenumbers.io",
        kind: "team",
      });
      expect(alice.ok && bob.ok).toBe(true);
      if (!alice.ok || !bob.ok) return;
      expect(bob.value.orgId).toBe(alice.value.orgId);
      expect(bob.value.rootFolderId).toBe(alice.value.rootFolderId);
      expect(bob.value.userId).not.toBe(alice.value.userId);
    });

    it("findOrgByClerkOrgId maps a mirrored Clerk org to our OrgId; null when unknown", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");
      const found = await h.store.findOrgByClerkOrgId(CO);
      expect(found.ok && found.value).toBe(created.value.orgId);

      const unknown = await h.store.findOrgByClerkOrgId("clerk_org_nope");
      expect(unknown.ok && unknown.value).toBeNull();
    });

    // ── Soft delete is terminal (ADR-0054) ─────────────────────────────────
    it("softDeleteByClerkId returns the userId and hides the user from findByClerk", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");

      const deleted = await h.store.softDeleteByClerkId(CU);
      expect(deleted.ok && deleted.value).toBe(created.value.userId);

      const found = await h.store.findByClerk(CU, CO);
      expect(found.ok && found.value).toBeNull();
    });

    it("softDeleteByClerkId returns null for an unknown clerk id (idempotent no-op)", async () => {
      const r = await h.store.softDeleteByClerkId("clerk_user_ghost");
      expect(r.ok && r.value).toBeNull();
    });

    it("softDeleteByClerkId re-resolves an already-deleted user (self-healing webhook retry)", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");
      await h.store.softDeleteByClerkId(CU);
      const again = await h.store.softDeleteByClerkId(CU);
      expect(again.ok && again.value).toBe(created.value.userId);
    });

    it("createIdentity refuses to resurrect a soft-deleted user — deletion is terminal (ADR-0054)", async () => {
      await mirror();
      await h.store.softDeleteByClerkId(CU);

      const reprovision = await mirror();
      expect(reprovision.ok).toBe(false);
      if (!reprovision.ok) expect(reprovision.error.kind).toBe("NotAllowed");
    });

    // ── Email lookups (ADR-0060 §2) ────────────────────────────────────────
    it("findEmailByUserId returns the mirrored email; null for an unknown id", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");
      const found = await h.store.findEmailByUserId(created.value.userId);
      expect(found.ok && found.value).toBe("ann@example.com");

      const unknown = await h.store.findEmailByUserId(UNKNOWN_USER_ID);
      expect(unknown.ok && unknown.value).toBeNull();
    });

    it("findEmailByUserId returns null for a soft-deleted user (no PII leak, ADR-0054/0070)", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");
      await h.store.softDeleteByClerkId(CU);
      const email = await h.store.findEmailByUserId(created.value.userId);
      expect(email.ok && email.value).toBeNull();
    });

    it("createIdentity refreshes a changed mirrored email on re-provision (review #150 M-2)", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");
      await mirror({ email: "ann.new@example.com", displayName: null });
      const email = await h.store.findEmailByUserId(created.value.userId);
      expect(email.ok && email.value).toBe("ann.new@example.com");
    });

    it("findUserIdByEmail resolves case-insensitively with whitespace trimmed; null when unknown", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");
      const found = await h.store.findUserIdByEmail("  ANN@Example.com  ");
      expect(found.ok && found.value).toBe(created.value.userId);

      const none = await h.store.findUserIdByEmail("nobody@example.com");
      expect(none.ok && none.value).toBeNull();
    });

    it("findUserIdByEmail does not resolve a soft-deleted user", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");
      await h.store.softDeleteByClerkId(CU);
      const found = await h.store.findUserIdByEmail("ann@example.com");
      expect(found.ok && found.value).toBeNull();
    });

    // ── Display names (ADR-0063, backfill roadmap #59) ─────────────────────
    it("findAuthorIdentityByUserId round-trips email + display name; null displayName when none stored", async () => {
      const named = await mirror();
      if (!named.ok) throw new Error("mirror failed");
      const author = await h.store.findAuthorIdentityByUserId(named.value.userId);
      expect(author.ok && author.value).toEqual({
        email: "ann@example.com",
        displayName: "Ann Anderson",
      });

      const unnamed = await mirror({
        clerkUserId: "clerk_user_noname",
        clerkOrgId: "clerk_org_noname",
        email: "noname@example.com",
        displayName: null,
        orgName: "noname's workspace",
      });
      if (!unnamed.ok) throw new Error("mirror failed");
      const anon = await h.store.findAuthorIdentityByUserId(unnamed.value.userId);
      expect(anon.ok && anon.value).toEqual({ email: "noname@example.com", displayName: null });
    });

    it("findAuthorIdentityByUserId returns null for a soft-deleted user (no PII leak, ADR-0054/0070)", async () => {
      const created = await mirror();
      if (!created.ok) throw new Error("mirror failed");
      await h.store.softDeleteByClerkId(CU);
      const author = await h.store.findAuthorIdentityByUserId(created.value.userId);
      expect(author.ok && author.value).toBeNull();
    });

    it("a re-provision with a null display name PRESERVES a previously stored name (COALESCE)", async () => {
      const first = await mirror(); // stores "Ann Anderson"
      if (!first.ok) throw new Error("mirror failed");
      await mirror({ displayName: null });
      const author = await h.store.findAuthorIdentityByUserId(first.value.userId);
      expect(author.ok && author.value?.displayName).toBe("Ann Anderson");
    });

    it("listUsersMissingDisplayName returns only live users with a null name, with keyset pagination", async () => {
      const seedUser = (clerkId: string, name: string | null) =>
        mirror({
          clerkUserId: clerkId,
          clerkOrgId: `org_${clerkId}`,
          email: `${clerkId}@example.com`,
          displayName: name,
          orgName: `${clerkId}'s workspace`,
        });
      const noName1 = await seedUser("cu_noname1", null);
      const withName = await seedUser("cu_hasname", "Has Name");
      const noName2 = await seedUser("cu_noname2", null);
      const deleted = await seedUser("cu_deleted", null);
      if (!noName1.ok || !withName.ok || !noName2.ok || !deleted.ok) {
        throw new Error("seed failed");
      }
      await h.store.softDeleteByClerkId("cu_deleted");

      const page = await h.store.listUsersMissingDisplayName({ limit: 50 });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      const ids = page.value.items.map((i) => i.userId).sort();
      expect(ids).toEqual([noName1.value.userId, noName2.value.userId].sort());
      const ref = page.value.items.find((i) => i.userId === noName1.value.userId);
      expect(ref?.clerkUserId).toBe("cu_noname1");

      // Keyset pagination: limit 1 → hasMore, and the next page doesn't overlap.
      const first = await h.store.listUsersMissingDisplayName({ limit: 1 });
      expect(first.ok && first.value.hasMore).toBe(true);
      const cursor = first.ok ? first.value.items[0]?.userId : undefined;
      const second = await h.store.listUsersMissingDisplayName({
        limit: 1,
        startingAfter: cursor,
      });
      expect(second.ok && second.value.items).toHaveLength(1);
      expect(second.ok && second.value.hasMore).toBe(false);
      expect(second.ok && second.value.items[0]?.userId).not.toBe(cursor);
    });

    it("setDisplayNameIfNull writes only a null name (true), never overwrites (false), and skips soft-deleted (false)", async () => {
      const unnamed = await mirror({
        clerkUserId: "cu_write",
        clerkOrgId: "org_cu_write",
        email: "cu_write@example.com",
        displayName: null,
      });
      if (!unnamed.ok) throw new Error("mirror failed");
      const wrote = await h.store.setDisplayNameIfNull(unnamed.value.userId, "Written Name");
      expect(wrote.ok && wrote.value).toBe(true);
      const author = await h.store.findAuthorIdentityByUserId(unnamed.value.userId);
      expect(author.ok && author.value?.displayName).toBe("Written Name");

      // Already named → no-op false, name untouched.
      const again = await h.store.setDisplayNameIfNull(unnamed.value.userId, "Should Not Apply");
      expect(again.ok && again.value).toBe(false);
      const after = await h.store.findAuthorIdentityByUserId(unnamed.value.userId);
      expect(after.ok && after.value?.displayName).toBe("Written Name");

      // Soft-deleted → false (no PII resurrection).
      const doomed = await mirror({
        clerkUserId: "cu_softdel",
        clerkOrgId: "org_cu_softdel",
        email: "cu_softdel@example.com",
        displayName: null,
      });
      if (!doomed.ok) throw new Error("mirror failed");
      await h.store.softDeleteByClerkId("cu_softdel");
      const onDeleted = await h.store.setDisplayNameIfNull(doomed.value.userId, "Nope");
      expect(onDeleted.ok && onDeleted.value).toBe(false);
    });
  });
}

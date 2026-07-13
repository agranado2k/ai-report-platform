// Integration tests for DrizzleIdentityStore against real Postgres (pglite),
// reusing the #52 harness. No seedIdentity — these create the trio from scratch.

import { folders, orgs } from "arp-db/schema";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleIdentityStore } from "./identity-store";
import { makeTestDb, type TestDb } from "./testing/pglite";

const CU = "clerk_user_1";
const CO = "clerk_org_1";

describe("DrizzleIdentityStore (pglite integration)", () => {
  let tdb: TestDb;
  let store: DrizzleIdentityStore;

  beforeEach(async () => {
    tdb = await makeTestDb();
    store = new DrizzleIdentityStore(tdb.ctx);
  });
  afterEach(() => tdb.close());

  it("findByClerk returns null when the identity isn't mirrored yet", async () => {
    const r = await store.findByClerk(CU, CO);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBeNull();
  });

  it("createIdentity mirrors User + Org + Root folder, then findByClerk returns it", async () => {
    const created = await store.createIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      displayName: "Ann Anderson",
      orgName: "ann's workspace",
      kind: "personal",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.userId).toBeTruthy();
    expect(created.value.orgId).toBeTruthy();
    expect(created.value.rootFolderId).toBeTruthy();

    const found = await store.findByClerk(CU, CO);
    expect(found.ok).toBe(true);
    if (found.ok && found.value) {
      expect(found.value.orgId).toBe(created.value.orgId);
      expect(found.value.userId).toBe(created.value.userId);
      expect(found.value.rootFolderId).toBe(created.value.rootFolderId);
    }
  });

  it("is idempotent — re-creating the same identity returns the same ids (no duplicates)", async () => {
    const a = await store.createIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      displayName: "Ann Anderson",
      orgName: "ann's workspace",
      kind: "personal",
    });
    const b = await store.createIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      displayName: "Ann Anderson",
      orgName: "ann's workspace",
      kind: "personal",
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.value.userId).toBe(a.value.userId);
      expect(b.value.orgId).toBe(a.value.orgId);
      expect(b.value.rootFolderId).toBe(a.value.rootFolderId);
    }
  });

  it("the partial unique index rejects a second Root folder for the same org", async () => {
    const created = await store.createIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      displayName: null,
      orgName: "ann's workspace",
      kind: "personal",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // A second top-level (parent_id NULL) folder with the same slug must violate
    // folders_org_root_slug_uniq — this is what prevents ghost Root folders.
    await expect(
      tdb.ctx.current().insert(folders).values({
        id: uuidv7(),
        orgId: created.value.orgId,
        name: "Root again",
        slug: "root",
        parentId: null,
      }),
    ).rejects.toThrow();
  });

  // ── User soft-delete (ADR-0054) ──────────────────────────────────────────
  const mirror = () =>
    store.createIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      displayName: "Ann Anderson",
      orgName: "ann's workspace",
      kind: "personal",
    });

  it("softDeleteByClerkId stamps deleted_at, returns the userId, and hides the user from findByClerk", async () => {
    const created = await mirror();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deleted = await store.softDeleteByClerkId(CU);
    expect(deleted.ok && deleted.value).toBe(created.value.userId);

    const found = await store.findByClerk(CU, CO);
    expect(found.ok && found.value).toBeNull(); // soft-deleted → no actor
  });

  it("softDeleteByClerkId returns null for an unknown user", async () => {
    const unknown = await store.softDeleteByClerkId("clerk_user_ghost");
    expect(unknown.ok && unknown.value).toBeNull();
  });

  it("findEmailByUserId returns null for a soft-deleted user (no PII leak, ADR-0054/0070)", async () => {
    const created = await mirror();
    if (!created.ok) return;
    await store.softDeleteByClerkId(CU);
    const email = await store.findEmailByUserId(created.value.userId);
    expect(email.ok && email.value).toBeNull(); // deleted → email must not resolve
  });

  it("softDeleteByClerkId re-resolves an already-deleted user (self-healing retry)", async () => {
    const created = await mirror();
    if (!created.ok) return;
    const first = await store.softDeleteByClerkId(CU);
    expect(first.ok && first.value).toBe(created.value.userId);
    // A replay still returns the same userId so a retried webhook can re-run the cascade
    // (the deleted_at timestamp is preserved by COALESCE, not overwritten).
    const again = await store.softDeleteByClerkId(CU);
    expect(again.ok && again.value).toBe(created.value.userId);
  });

  it("createIdentity refuses to resurrect a soft-deleted user — deletion is terminal", async () => {
    await mirror();
    await store.softDeleteByClerkId(CU);

    const reprovision = await mirror();
    expect(reprovision.ok).toBe(false);
    if (!reprovision.ok) expect(reprovision.error.kind).toBe("NotAllowed");
  });

  // ── Write-grant email lookups (ADR-0060 §2) ──────────────────────────────
  it("findOrgByClerkOrgId maps a Clerk org to our OrgId WITHOUT needing a user row", async () => {
    const created = await mirror();
    if (!created.ok) return;
    // The org-unlock decision needs only the Clerk-verified session org mapped
    // to an internal OrgId — a member who never wrote (no users row for them)
    // must still resolve (review #150 H-1).
    const found = await store.findOrgByClerkOrgId(CO);
    expect(found.ok && found.value).toBe(created.value.orgId);

    const unknown = await store.findOrgByClerkOrgId("clerk_org_nope");
    expect(unknown.ok && unknown.value).toBeNull();
  });

  it("createIdentity refreshes a changed mirrored email on re-provision", async () => {
    const created = await mirror();
    if (!created.ok) return;
    // Same Clerk user, new primary email (changed in Clerk) — the mirror must
    // follow, or ADR-0060 email-based grant matching silently 403s the grantee
    // at their current address (review #150 M-2).
    const again = await store.createIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann.new@example.com",
      displayName: null,
      orgName: "ann's workspace",
      kind: "personal",
    });
    expect(again.ok).toBe(true);
    const email = await store.findEmailByUserId(created.value.userId);
    expect(email.ok && email.value).toBe("ann.new@example.com");
  });

  it("createIdentity stores the display name; findAuthorIdentityByUserId round-trips it (ADR-0063)", async () => {
    const created = await mirror(); // seeded with displayName "Ann Anderson"
    if (!created.ok) return;
    const author = await store.findAuthorIdentityByUserId(created.value.userId);
    expect(author.ok && author.value).toEqual({
      email: "ann@example.com",
      displayName: "Ann Anderson",
    });
  });

  it("createIdentity stores a null display name when none is given (name column nullable)", async () => {
    const created = await store.createIdentity({
      clerkUserId: "clerk_user_noname",
      clerkOrgId: "clerk_org_noname",
      email: "noname@example.com",
      displayName: null,
      orgName: "noname's workspace",
      kind: "personal",
    });
    if (!created.ok) return;
    const author = await store.findAuthorIdentityByUserId(created.value.userId);
    expect(author.ok && author.value).toEqual({ email: "noname@example.com", displayName: null });
  });

  it("re-provision with a null display name PRESERVES a previously stored name (COALESCE)", async () => {
    const first = await mirror(); // stores "Ann Anderson"
    if (!first.ok) return;
    // A later claim-less session (displayName null) must not wipe the name.
    await store.createIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      displayName: null,
      orgName: "ann's workspace",
      kind: "personal",
    });
    const author = await store.findAuthorIdentityByUserId(first.value.userId);
    expect(author.ok && author.value?.displayName).toBe("Ann Anderson");
  });

  it("findAuthorIdentityByUserId returns null for a soft-deleted user (no PII leak, ADR-0054/0070)", async () => {
    const created = await mirror();
    if (!created.ok) return;
    await store.softDeleteByClerkId(CU);
    const author = await store.findAuthorIdentityByUserId(created.value.userId);
    expect(author.ok && author.value).toBeNull();
  });

  it("findEmailByUserId returns the mirrored email; null for an unknown id", async () => {
    const created = await mirror();
    if (!created.ok) return;
    const found = await store.findEmailByUserId(created.value.userId);
    expect(found.ok && found.value).toBe("ann@example.com");

    const unknown = await store.findEmailByUserId(
      "00000000-0000-7000-8000-00000000dead" as typeof created.value.userId,
    );
    expect(unknown.ok && unknown.value).toBeNull();
  });

  it("findUserIdByEmail resolves case-insensitively; null when no user has that email", async () => {
    const created = await mirror();
    if (!created.ok) return;
    const found = await store.findUserIdByEmail("  ANN@Example.com  ");
    expect(found.ok && found.value).toBe(created.value.userId);

    const none = await store.findUserIdByEmail("nobody@example.com");
    expect(none.ok && none.value).toBeNull();
  });

  it("findUserIdByEmail does not resolve a soft-deleted user", async () => {
    const created = await mirror();
    if (!created.ok) return;
    await store.softDeleteByClerkId(CU);
    const found = await store.findUserIdByEmail("ann@example.com");
    expect(found.ok && found.value).toBeNull();
  });

  // ── display_name backfill target-set + null-guarded write (roadmap #59) ───
  describe("listUsersMissingDisplayName / setDisplayNameIfNull", () => {
    const seedUser = (clerkId: string, name: string | null) =>
      store.createIdentity({
        clerkUserId: clerkId,
        clerkOrgId: `org_${clerkId}`,
        email: `${clerkId}@example.com`,
        displayName: name,
        orgName: `${clerkId}'s workspace`,
        kind: "personal",
      });

    it("returns only users with a null display name, excluding soft-deleted", async () => {
      const noName1 = await seedUser("cu_noname1", null);
      const withName = await seedUser("cu_hasname", "Has Name");
      const noName2 = await seedUser("cu_noname2", null);
      const deleted = await seedUser("cu_deleted", null);
      if (!noName1.ok || !withName.ok || !noName2.ok || !deleted.ok) throw new Error("seed failed");
      await store.softDeleteByClerkId("cu_deleted");

      const page = await store.listUsersMissingDisplayName({ limit: 50 });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      const ids = page.value.items.map((i) => i.userId).sort();
      expect(ids).toEqual([noName1.value.userId, noName2.value.userId].sort());
      // Neither the named user nor the soft-deleted one appears.
      expect(ids).not.toContain(withName.value.userId);
      expect(ids).not.toContain(deleted.value.userId);
      // Each ref carries the clerkUserId needed to re-fetch from Clerk.
      const ref = page.value.items.find((i) => i.userId === noName1.value.userId);
      expect(ref?.clerkUserId).toBe("cu_noname1");
    });

    it("paginates with keyset (hasMore + startingAfter)", async () => {
      for (let i = 0; i < 3; i += 1) await seedUser(`cu_page_${i}`, null);
      const first = await store.listUsersMissingDisplayName({ limit: 2 });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.items).toHaveLength(2);
      expect(first.value.hasMore).toBe(true);

      const cursor = first.value.items[1]?.userId;
      const second = await store.listUsersMissingDisplayName({ limit: 2, startingAfter: cursor });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.items).toHaveLength(1);
      expect(second.value.hasMore).toBe(false);
      // No overlap between pages.
      const firstIds = new Set(first.value.items.map((i) => i.userId));
      expect(second.value.items.every((i) => !firstIds.has(i.userId))).toBe(true);
    });

    it("setDisplayNameIfNull writes when null and returns true; then drops out of the target set", async () => {
      const u = await seedUser("cu_write", null);
      if (!u.ok) return;
      const wrote = await store.setDisplayNameIfNull(u.value.userId, "Written Name");
      expect(wrote.ok && wrote.value).toBe(true);

      const author = await store.findAuthorIdentityByUserId(u.value.userId);
      expect(author.ok && author.value?.displayName).toBe("Written Name");
      const page = await store.listUsersMissingDisplayName({ limit: 50 });
      expect(page.ok && page.value.items.map((i) => i.userId)).not.toContain(u.value.userId);
    });

    it("setDisplayNameIfNull is a no-op on an already-named user (returns false, never overwrites)", async () => {
      const u = await seedUser("cu_named", "Original Name");
      if (!u.ok) return;
      const wrote = await store.setDisplayNameIfNull(u.value.userId, "Should Not Apply");
      expect(wrote.ok && wrote.value).toBe(false);
      const author = await store.findAuthorIdentityByUserId(u.value.userId);
      expect(author.ok && author.value?.displayName).toBe("Original Name");
    });

    it("setDisplayNameIfNull returns false for a soft-deleted user (no PII resurrection)", async () => {
      const u = await seedUser("cu_softdel", null);
      if (!u.ok) return;
      await store.softDeleteByClerkId("cu_softdel");
      const wrote = await store.setDisplayNameIfNull(u.value.userId, "Nope");
      expect(wrote.ok && wrote.value).toBe(false);
    });
  });

  // ── Team orgs — JIT join-or-create mirroring (ADR-0068 §3) ───────────────
  describe("createIdentity with kind: 'team'", () => {
    const TEAM_ORG = "clerk_org_team_housenumbers";

    it("persists orgs.kind = 'team' on first creation", async () => {
      const created = await store.createIdentity({
        clerkUserId: "clerk_user_alice",
        clerkOrgId: TEAM_ORG,
        email: "alice@housenumbers.io",
        displayName: "Alice Ackerman",
        orgName: "housenumbers.io",
        kind: "team",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const [row] = await tdb.ctx
        .current()
        .select({ kind: orgs.kind })
        .from(orgs)
        .where(eq(orgs.id, created.value.orgId));
      expect(row?.kind).toBe("team");
    });

    it("a second colleague joining the SAME team org mirrors a distinct User under the SAME Org (no duplicate org row)", async () => {
      const alice = await store.createIdentity({
        clerkUserId: "clerk_user_alice",
        clerkOrgId: TEAM_ORG,
        email: "alice@housenumbers.io",
        displayName: "Alice Ackerman",
        orgName: "housenumbers.io",
        kind: "team",
      });
      expect(alice.ok).toBe(true);
      if (!alice.ok) return;

      const bob = await store.createIdentity({
        clerkUserId: "clerk_user_bob",
        clerkOrgId: TEAM_ORG,
        email: "bob@housenumbers.io",
        displayName: "Bob Baxter",
        orgName: "housenumbers.io",
        kind: "team",
      });
      expect(bob.ok).toBe(true);
      if (!bob.ok) return;

      // Same org, same root folder, DIFFERENT user — the domain org is
      // multi-member by design (ADR-0068 §1).
      expect(bob.value.orgId).toBe(alice.value.orgId);
      expect(bob.value.rootFolderId).toBe(alice.value.rootFolderId);
      expect(bob.value.userId).not.toBe(alice.value.userId);

      // Still exactly one orgs row for the team org, and it's still kind 'team'.
      const rows = await tdb.ctx
        .current()
        .select({ id: orgs.id, kind: orgs.kind })
        .from(orgs)
        .where(eq(orgs.id, alice.value.orgId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe("team");
    });
  });
});

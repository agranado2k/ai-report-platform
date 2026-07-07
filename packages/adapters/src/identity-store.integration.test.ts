// Integration tests for DrizzleIdentityStore against real Postgres (pglite),
// reusing the #52 harness. No seedIdentity — these create the trio from scratch.
import { folders } from "arp-db/schema";
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

  it("createPersonalIdentity mirrors User + Org + Root folder, then findByClerk returns it", async () => {
    const created = await store.createPersonalIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      orgName: "ann's workspace",
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
    const a = await store.createPersonalIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      orgName: "ann's workspace",
    });
    const b = await store.createPersonalIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      orgName: "ann's workspace",
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.value.userId).toBe(a.value.userId);
      expect(b.value.orgId).toBe(a.value.orgId);
      expect(b.value.rootFolderId).toBe(a.value.rootFolderId);
    }
  });

  it("the partial unique index rejects a second Root folder for the same org", async () => {
    const created = await store.createPersonalIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      orgName: "ann's workspace",
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
    store.createPersonalIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann@example.com",
      orgName: "ann's workspace",
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

  it("createPersonalIdentity refuses to resurrect a soft-deleted user — deletion is terminal", async () => {
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

  it("createPersonalIdentity refreshes a changed mirrored email on re-provision", async () => {
    const created = await mirror();
    if (!created.ok) return;
    // Same Clerk user, new primary email (changed in Clerk) — the mirror must
    // follow, or ADR-0060 email-based grant matching silently 403s the grantee
    // at their current address (review #150 M-2).
    const again = await store.createPersonalIdentity({
      clerkUserId: CU,
      clerkOrgId: CO,
      email: "ann.new@example.com",
      orgName: "ann's workspace",
    });
    expect(again.ok).toBe(true);
    const email = await store.findEmailByUserId(created.value.userId);
    expect(email.ok && email.value).toBe("ann.new@example.com");
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
});

// Integration tests for DrizzleIdentityStore against real Postgres (pglite),
// reusing the #52 harness. No seedIdentity — these create the trio from scratch.
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
});

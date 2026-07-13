import { type AppError, userId as makeUserId, ok, type Result, type UserId } from "arp-domain";
import { describe, expect, it } from "vitest";
import type { CursorParams, MirroredUserRef } from "../ports";
import {
  type BackfillDisplayNamesDeps,
  backfillDisplayNames,
  type ClerkDisplayNameSource,
} from "./backfill-display-names";

// ── Fakes ────────────────────────────────────────────────────────────────
// A minimal IdentityStore-shaped fake for the two seams the job uses. Rows are
// held in insertion order; the target set is `display_name === null`. Keyset
// paginates on `userId` DESC to mirror the real adapter (ADR-0053).
interface Row {
  readonly userId: UserId;
  readonly clerkUserId: string;
  displayName: string | null;
  deleted: boolean;
}

class FakeIdentityStore {
  constructor(private readonly rows: Row[]) {}
  /** Count of `setDisplayNameIfNull` calls that actually wrote (for assertions). */
  writes = 0;

  async listUsersMissingDisplayName(
    q: CursorParams<UserId>,
  ): Promise<Result<{ items: readonly MirroredUserRef[]; hasMore: boolean }, AppError>> {
    const eligible = this.rows
      .filter((r) => r.displayName === null && !r.deleted)
      .sort((a, b) => (a.userId < b.userId ? 1 : a.userId > b.userId ? -1 : 0)); // id DESC
    // Range keyset (mirrors the adapter's `lt(users.id, cursor)`), so a cursor
    // row that was written (and dropped from the set) still pages correctly.
    const after = q.startingAfter;
    const pool = after ? eligible.filter((r) => r.userId < after) : eligible;
    const items = pool
      .slice(0, q.limit)
      .map((r) => ({ userId: r.userId, clerkUserId: r.clerkUserId }));
    return ok({ items, hasMore: pool.length > q.limit });
  }

  async setDisplayNameIfNull(
    userId: UserId,
    displayName: string,
  ): Promise<Result<boolean, AppError>> {
    const row = this.rows.find((r) => r.userId === userId);
    if (!row || row.deleted || row.displayName !== null) return ok(false);
    row.displayName = displayName;
    this.writes += 1;
    return ok(true);
  }

  nameOf(userId: UserId): string | null {
    return this.rows.find((r) => r.userId === userId)?.displayName ?? null;
  }
}

/** Clerk source driven by a `clerkUserId → name` map. A `null` value = Clerk has
 *  no usable name; a missing key = a per-user Clerk fetch error (isolated). */
class FakeClerk implements ClerkDisplayNameSource {
  calls: string[] = [];
  constructor(private readonly names: Record<string, string | null>) {}
  async getDisplayName(clerkUserId: string): Promise<Result<string | null, AppError>> {
    this.calls.push(clerkUserId);
    if (!(clerkUserId in this.names)) {
      return { ok: false, error: { kind: "Unexpected", message: "clerk fetch failed" } };
    }
    return ok(this.names[clerkUserId] ?? null);
  }
}

const uid = (n: number): UserId =>
  makeUserId(`00000000-0000-7000-8000-0000000000${n.toString().padStart(2, "0")}`);
const row = (n: number, displayName: string | null = null, deleted = false): Row => ({
  userId: uid(n),
  clerkUserId: `clerk_${n}`,
  displayName,
  deleted,
});

function makeDeps(store: FakeIdentityStore, clerk: FakeClerk): BackfillDisplayNamesDeps {
  return { identities: store, clerk };
}

describe("backfillDisplayNames", () => {
  it("populates only null-display-name users, from Clerk, and reports the counts", async () => {
    const store = new FakeIdentityStore([row(1), row(2), row(3, "Already Set")]);
    const clerk = new FakeClerk({ clerk_1: "Ann Anderson", clerk_2: "Bob Baxter" });

    const r = await backfillDisplayNames(makeDeps(store, clerk), { batchSize: 10, dryRun: false });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ scanned: 2, updated: 2, skipped: 0, errors: 0 });
    expect(store.nameOf(uid(1))).toBe("Ann Anderson");
    expect(store.nameOf(uid(2))).toBe("Bob Baxter");
    // A user that already had a name was never in the target set → never fetched.
    expect(clerk.calls).not.toContain("clerk_3");
  });

  it("dry-run reports would-be updates but writes nothing (fail-safe default)", async () => {
    const store = new FakeIdentityStore([row(1), row(2)]);
    const clerk = new FakeClerk({ clerk_1: "Ann Anderson", clerk_2: "Bob Baxter" });

    const r = await backfillDisplayNames(makeDeps(store, clerk), { batchSize: 10, dryRun: true });

    expect(r.ok && r.value).toEqual({ scanned: 2, updated: 2, skipped: 0, errors: 0 });
    expect(store.writes).toBe(0);
    expect(store.nameOf(uid(1))).toBeNull();
    expect(store.nameOf(uid(2))).toBeNull();
  });

  it("is idempotent — a second run over the already-populated set is a no-op", async () => {
    const store = new FakeIdentityStore([row(1), row(2)]);
    const clerk = new FakeClerk({ clerk_1: "Ann Anderson", clerk_2: "Bob Baxter" });

    const first = await backfillDisplayNames(makeDeps(store, clerk), {
      batchSize: 10,
      dryRun: false,
    });
    expect(first.ok && first.value.updated).toBe(2);

    const writesAfterFirst = store.writes;
    const second = await backfillDisplayNames(makeDeps(store, clerk), {
      batchSize: 10,
      dryRun: false,
    });
    expect(second.ok && second.value).toEqual({ scanned: 0, updated: 0, skipped: 0, errors: 0 });
    expect(store.writes).toBe(writesAfterFirst); // no further writes
  });

  it("skips users Clerk has no usable name for", async () => {
    const store = new FakeIdentityStore([row(1), row(2)]);
    const clerk = new FakeClerk({ clerk_1: "Ann Anderson", clerk_2: null });

    const r = await backfillDisplayNames(makeDeps(store, clerk), { batchSize: 10, dryRun: false });

    expect(r.ok && r.value).toEqual({ scanned: 2, updated: 1, skipped: 1, errors: 0 });
    expect(store.nameOf(uid(2))).toBeNull();
  });

  it("isolates a single user's Clerk failure — the batch still finishes", async () => {
    const store = new FakeIdentityStore([row(1), row(2), row(3)]);
    // clerk_2 is absent from the map → getDisplayName errors for that user only.
    const clerk = new FakeClerk({ clerk_1: "Ann Anderson", clerk_3: "Carla Cruz" });

    const r = await backfillDisplayNames(makeDeps(store, clerk), { batchSize: 10, dryRun: false });

    expect(r.ok && r.value).toEqual({ scanned: 3, updated: 2, skipped: 0, errors: 1 });
    expect(store.nameOf(uid(1))).toBe("Ann Anderson");
    expect(store.nameOf(uid(3))).toBe("Carla Cruz");
  });

  it("isolates a single user's write failure", async () => {
    const store = new FakeIdentityStore([row(1), row(2)]);
    // Make user 2's write throw an error by overriding the method.
    const original = store.setDisplayNameIfNull.bind(store);
    store.setDisplayNameIfNull = async (userId, name) => {
      if (userId === uid(2))
        return { ok: false, error: { kind: "Unexpected", message: "db down" } };
      return original(userId, name);
    };
    const clerk = new FakeClerk({ clerk_1: "Ann Anderson", clerk_2: "Bob Baxter" });

    const r = await backfillDisplayNames(makeDeps(store, clerk), { batchSize: 10, dryRun: false });

    expect(r.ok && r.value).toEqual({ scanned: 2, updated: 1, skipped: 0, errors: 1 });
    expect(store.nameOf(uid(1))).toBe("Ann Anderson");
  });

  it("pages through the target set across multiple batches", async () => {
    const store = new FakeIdentityStore([row(1), row(2), row(3), row(4), row(5)]);
    const clerk = new FakeClerk({
      clerk_1: "One",
      clerk_2: "Two",
      clerk_3: "Three",
      clerk_4: "Four",
      clerk_5: "Five",
    });

    const r = await backfillDisplayNames(makeDeps(store, clerk), { batchSize: 2, dryRun: false });

    expect(r.ok && r.value).toEqual({ scanned: 5, updated: 5, skipped: 0, errors: 0 });
    expect(store.nameOf(uid(5))).toBe("Five");
  });

  it("honors maxUsers as a per-run scan cap", async () => {
    const store = new FakeIdentityStore([row(1), row(2), row(3), row(4)]);
    const clerk = new FakeClerk({
      clerk_1: "One",
      clerk_2: "Two",
      clerk_3: "Three",
      clerk_4: "Four",
    });

    const r = await backfillDisplayNames(makeDeps(store, clerk), {
      batchSize: 10,
      dryRun: false,
      maxUsers: 2,
    });

    expect(r.ok && r.value.scanned).toBe(2);
    expect(r.ok && r.value.updated).toBe(2);
  });

  it("a page-list failure is fatal (can't page the target set)", async () => {
    const store = new FakeIdentityStore([row(1)]);
    store.listUsersMissingDisplayName = async () => ({
      ok: false,
      error: { kind: "Unexpected", message: "db down" },
    });
    const clerk = new FakeClerk({ clerk_1: "Ann" });

    const r = await backfillDisplayNames(makeDeps(store, clerk), { batchSize: 10, dryRun: false });
    expect(r.ok).toBe(false);
  });
});

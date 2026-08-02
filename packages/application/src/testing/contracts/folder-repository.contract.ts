// Shared FolderRepository contract (ADR-0020 port, ADR-0036 sibling-slug
// uniqueness, ADR-0046 two-tier testing). Run against both
// InMemoryFolderRepository and DrizzleFolderRepository-on-pglite so the fake's
// clash-detection, soft-delete, and ADR-0076 visibility-predicate semantics
// stay honest against the real DB's partial unique index + SQL predicate.
import type {
  AppError,
  Folder,
  FolderId,
  FolderVisibility,
  OrgId,
  Result,
  UserId,
} from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FolderRepository, FolderShareStore } from "../../ports";

export interface FolderRepositoryContractHarness {
  readonly repo: FolderRepository;
  readonly orgId: OrgId;
  /** A parent folder already persisted in the harness (Root, or equivalent) —
   *  new fixtures nest under it unless a test overrides `parentId`. Persisted
   *  in the legacy Root shape: ownerId NULL, visibility `org` (ADR-0076). */
  readonly rootFolderId: FolderId;
  /** A user that exists (a real FK on the Drizzle harness) — the default
   *  "owner" identity of the visibility matrix. */
  readonly ownerUserId: UserId;
  /** A second existing user — the "colleague" viewer who owns nothing. */
  readonly colleagueUserId: UserId;
  /** The share store the repo's ADR-0076 predicate reads — the SAME instance
   *  (in-memory) or the same database (Drizzle). */
  readonly shares: FolderShareStore;
  /** A fresh, valid Folder under the harness's org — id/name auto-generated
   *  and overridable. Legacy shape by default (ownerId null, `org`). Does NOT
   *  save it; the test calls `repo.save()`. */
  makeFolder(overrides?: {
    readonly id?: FolderId;
    readonly name?: string;
    readonly parentId?: FolderId | null;
    readonly ownerId?: UserId | null;
    readonly visibility?: FolderVisibility;
  }): Folder;
  teardown(): Promise<void>;
}

export function describeFolderRepositoryContract(
  label: string,
  setup: () => Promise<FolderRepositoryContractHarness>,
): void {
  describe(`FolderRepository contract (${label})`, () => {
    let h: FolderRepositoryContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("saves a folder and finds it by id", async () => {
      const folder = h.makeFolder({ name: "Archive" });
      expect((await h.repo.save(folder)).ok).toBe(true);

      const found = await h.repo.findById(folder.id);
      expect(found.ok && found.value?.name).toBe("Archive");
      expect(found.ok && found.value?.parentId).toBe(h.rootFolderId);
    });

    it("listByOrg returns saved, non-deleted folders for the org", async () => {
      const folder = h.makeFolder({ name: "Docs" });
      await h.repo.save(folder);
      const listed = await h.repo.listByOrg(h.orgId, { userId: h.ownerUserId });
      expect(listed.ok && listed.value.some((f) => f.id === folder.id)).toBe(true);
    });

    it("save() upserts by id — re-saving an existing id renames it in place", async () => {
      const folder = h.makeFolder({ name: "Before" });
      await h.repo.save(folder);
      await h.repo.save({ ...folder, name: "After", slug: "after" });

      const found = await h.repo.findById(folder.id);
      expect(found.ok && found.value?.name).toBe("After");
    });

    it("rejects a duplicate sibling slug (same parent) with a ValidationError", async () => {
      const first = h.makeFolder({ name: "Reports" });
      await h.repo.save(first);
      const dup = h.makeFolder({ name: "reports" }); // same slug, same parent
      const result: Result<void, AppError> = await h.repo.save(dup);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("ValidationError");
    });

    it("softDelete excludes the folder from listByOrg but keeps it findable by id", async () => {
      const folder = h.makeFolder({ name: "Temp" });
      await h.repo.save(folder);
      expect((await h.repo.softDelete(folder.id)).ok).toBe(true);

      const listed = await h.repo.listByOrg(h.orgId, { userId: h.ownerUserId });
      expect(listed.ok && listed.value.some((f) => f.id === folder.id)).toBe(false);

      const found = await h.repo.findById(folder.id);
      expect(found.ok && found.value?.deletedAt).not.toBeNull();
    });

    it("allows recreating a same-named sibling after the original is soft-deleted", async () => {
      const original = h.makeFolder({ name: "Quarterly" });
      await h.repo.save(original);
      await h.repo.softDelete(original.id);

      // Same name (→ same slug), same parent — the soft-deleted original must
      // not clash (a partial unique index on the real DB; the fake's clash
      // check must agree, ADR-0036).
      const recreated = h.makeFolder({ name: "Quarterly" });
      const result = await h.repo.save(recreated);
      expect(result.ok).toBe(true);

      const listed = await h.repo.listByOrg(h.orgId, { userId: h.ownerUserId });
      expect(listed.ok && listed.value.filter((f) => f.slug === "quarterly")).toHaveLength(1);
    });

    it("searchByOrg keyset-paginates folders newest-created first", async () => {
      // Each makeFolder() call mints a fresh, monotonically-increasing id, sorting
      // after the harness's pre-existing root folder (both harnesses guarantee
      // this), so creation order and id order agree: newest-first ends up
      // [Charlie, Bravo, Alpha, <the harness's root>].
      await h.repo.save(h.makeFolder({ name: "Alpha" }));
      await h.repo.save(h.makeFolder({ name: "Bravo" }));
      await h.repo.save(h.makeFolder({ name: "Charlie" }));

      const page1 = await h.repo.searchByOrg(h.orgId, { userId: h.ownerUserId }, { limit: 2 });
      expect(page1.ok && page1.value.items.map((f) => f.name)).toEqual(["Charlie", "Bravo"]);
      expect(page1.ok && page1.value.hasMore).toBe(true);

      const cursor = page1.ok ? page1.value.items[1]?.id : undefined;
      const page2 = await h.repo.searchByOrg(
        h.orgId,
        { userId: h.ownerUserId },
        { limit: 2, startingAfter: cursor },
      );
      expect(page2.ok && page2.value.items.map((f) => f.name)).toEqual(["Alpha", "Root"]);
      expect(page2.ok && page2.value.hasMore).toBe(false);
    });

    // ── ADR-0076 visibility matrix ────────────────────────────────────────
    describe("visibility predicate (ADR-0076)", () => {
      const names = (r: Awaited<ReturnType<FolderRepository["listByOrg"]>>) =>
        r.ok ? r.value.map((f) => f.name).sort() : [];

      it("the OWNER sees their private folder; a colleague does not (existence is private)", async () => {
        await h.repo.save(
          h.makeFolder({ name: "Secret", ownerId: h.ownerUserId, visibility: "private" }),
        );
        const mine = await h.repo.listByOrg(h.orgId, { userId: h.ownerUserId });
        expect(names(mine)).toContain("Secret");
        const theirs = await h.repo.listByOrg(h.orgId, { userId: h.colleagueUserId });
        expect(names(theirs)).not.toContain("Secret");
      });

      it("a LEGACY folder (ownerId null) is visible to everyone", async () => {
        await h.repo.save(h.makeFolder({ name: "Legacy" }));
        const listed = await h.repo.listByOrg(h.orgId, { userId: h.colleagueUserId });
        expect(names(listed)).toContain("Legacy");
      });

      it("an ORG-visible owned folder is visible to any member", async () => {
        await h.repo.save(
          h.makeFolder({ name: "Team", ownerId: h.ownerUserId, visibility: "org" }),
        );
        const listed = await h.repo.listByOrg(h.orgId, { userId: h.colleagueUserId });
        expect(names(listed)).toContain("Team");
      });

      it("a folder SHARE by resolved user id makes a private folder visible", async () => {
        const secret = h.makeFolder({
          name: "Shared by id",
          ownerId: h.ownerUserId,
          visibility: "private",
        });
        await h.repo.save(secret);
        await h.shares.grant(secret.id, "colleague@test.local", h.ownerUserId, h.colleagueUserId);
        const listed = await h.repo.listByOrg(h.orgId, { userId: h.colleagueUserId });
        expect(names(listed)).toContain("Shared by id");
      });

      it("a folder SHARE by email matches normalized, without a resolved user id", async () => {
        const secret = h.makeFolder({
          name: "Shared by email",
          ownerId: h.ownerUserId,
          visibility: "private",
        });
        await h.repo.save(secret);
        await h.shares.grant(secret.id, "Pal@Test.Local", h.ownerUserId, null);
        const listed = await h.repo.listByOrg(h.orgId, {
          userId: h.colleagueUserId,
          email: "  pal@test.LOCAL ",
        });
        expect(names(listed)).toContain("Shared by email");
      });

      it("the Root is ALWAYS visible (legacy + org shape)", async () => {
        const listed = await h.repo.listByOrg(h.orgId, { userId: h.colleagueUserId });
        expect(listed.ok && listed.value.some((f) => f.id === h.rootFolderId)).toBe(true);
      });

      it("searchByOrg applies the same predicate (paginated surface)", async () => {
        await h.repo.save(
          h.makeFolder({ name: "Hidden", ownerId: h.ownerUserId, visibility: "private" }),
        );
        const page = await h.repo.searchByOrg(
          h.orgId,
          { userId: h.colleagueUserId },
          { limit: 100 },
        );
        expect(page.ok && page.value.items.map((f) => f.name)).not.toContain("Hidden");
      });

      it("round-trips ownerId + visibility through save/findById", async () => {
        const f = h.makeFolder({ name: "Owned", ownerId: h.ownerUserId, visibility: "private" });
        await h.repo.save(f);
        const found = await h.repo.findById(f.id);
        expect(found.ok && found.value?.ownerId).toBe(h.ownerUserId);
        expect(found.ok && found.value?.visibility).toBe("private");
      });
    });

    describe("hasChildFolders (the deleteFolder emptiness guard)", () => {
      it("is false for a leaf, true once ANY child exists — even an invisible private one", async () => {
        const parent = h.makeFolder({ name: "Parent" });
        await h.repo.save(parent);
        const empty = await h.repo.hasChildFolders(h.orgId, parent.id);
        expect(empty.ok && empty.value).toBe(false);

        await h.repo.save(
          h.makeFolder({
            name: "Hidden child",
            parentId: parent.id,
            ownerId: h.ownerUserId,
            visibility: "private",
          }),
        );
        const withChild = await h.repo.hasChildFolders(h.orgId, parent.id);
        expect(withChild.ok && withChild.value).toBe(true);
      });

      it("ignores soft-deleted children", async () => {
        const parent = h.makeFolder({ name: "Parent2" });
        await h.repo.save(parent);
        const child = h.makeFolder({ name: "Child2", parentId: parent.id });
        await h.repo.save(child);
        await h.repo.softDelete(child.id);
        const after = await h.repo.hasChildFolders(h.orgId, parent.id);
        expect(after.ok && after.value).toBe(false);
      });
    });
  });
}

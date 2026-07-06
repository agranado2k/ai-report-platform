// Shared FolderRepository contract (ADR-0020 port, ADR-0036 sibling-slug
// uniqueness, ADR-0046 two-tier testing). Run against both
// InMemoryFolderRepository and DrizzleFolderRepository-on-pglite so the fake's
// clash-detection and soft-delete semantics stay honest against the real DB's
// partial unique index.
import type { AppError, Folder, FolderId, OrgId, Result } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FolderRepository } from "../../ports";

export interface FolderRepositoryContractHarness {
  readonly repo: FolderRepository;
  readonly orgId: OrgId;
  /** A parent folder already persisted in the harness (Root, or equivalent) —
   *  new fixtures nest under it unless a test overrides `parentId`. */
  readonly rootFolderId: FolderId;
  /** A fresh, valid Folder under the harness's org — id/name auto-generated
   *  and overridable. Does NOT save it; the test calls `repo.save()`. */
  makeFolder(overrides?: {
    readonly id?: FolderId;
    readonly name?: string;
    readonly parentId?: FolderId | null;
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
      const listed = await h.repo.listByOrg(h.orgId);
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

      const listed = await h.repo.listByOrg(h.orgId);
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

      const listed = await h.repo.listByOrg(h.orgId);
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

      const page1 = await h.repo.searchByOrg(h.orgId, { limit: 2 });
      expect(page1.ok && page1.value.items.map((f) => f.name)).toEqual(["Charlie", "Bravo"]);
      expect(page1.ok && page1.value.hasMore).toBe(true);

      const cursor = page1.ok ? page1.value.items[1]?.id : undefined;
      const page2 = await h.repo.searchByOrg(h.orgId, { limit: 2, startingAfter: cursor });
      expect(page2.ok && page2.value.items.map((f) => f.name)).toEqual(["Alpha", "Root"]);
      expect(page2.ok && page2.value.hasMore).toBe(false);
    });
  });
}

// Shared FolderShareStore contract (ADR-0076). Run against both
// InMemoryFolderShareStore and DrizzleFolderShareStore-on-pglite —
// grant/revoke/listByFolder/findFor and the dual userId-or-email match (a
// grantee's `grantee_user_id` may still be null if they hadn't signed up at
// share time, the ADR-0060 §2 pattern) must agree on both sides, since
// `findFor` backs the folder visibility predicate's share leg.
import type { FolderId, UserId } from "arp-domain";
import { userId } from "arp-domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FolderShareStore } from "../../ports";

export interface FolderShareStoreContractHarness {
  readonly store: FolderShareStore;
  /** A folder id the store's shares are scoped to (a real FK to a saved
   *  folder on the Drizzle harness; any id at all on the fake). */
  readonly folderId: FolderId;
  /** A SECOND, distinct folder id (also a real FK on the Drizzle harness).
   *  Without it every assertion here would hold for a store that ignored the
   *  folder correlation entirely and matched shares by grantee alone. */
  readonly otherFolderId: FolderId;
  /** A user id that exists (a real FK on the Drizzle harness) to use as
   *  `grantedBy` / an opportunistically-resolved `grantee_user_id`. */
  readonly existingUserId: UserId;
  teardown(): Promise<void>;
}

const STRANGER: UserId = userId("00000000-0000-7000-8000-00000000dead");

export function describeFolderShareStoreContract(
  label: string,
  setup: () => Promise<FolderShareStoreContractHarness>,
): void {
  describe(`FolderShareStore contract (${label})`, () => {
    let h: FolderShareStoreContractHarness;

    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("grant creates a row findFor can match by email; revoke removes it", async () => {
      const before = await h.store.findFor(h.folderId, { userId: STRANGER, email: "a@b.com" });
      expect(before.ok && before.value).toBeNull();

      await h.store.grant(h.folderId, "a@b.com", h.existingUserId, null);
      const found = await h.store.findFor(h.folderId, { userId: STRANGER, email: "a@b.com" });
      expect(found.ok && found.value?.granteeEmail).toBe("a@b.com");
      expect(found.ok && found.value?.granteeUserId).toBeNull();

      await h.store.revoke(h.folderId, "a@b.com");
      const after = await h.store.findFor(h.folderId, { userId: STRANGER, email: "a@b.com" });
      expect(after.ok && after.value).toBeNull();
    });

    it("matches by granteeUserId even when the caller's email differs", async () => {
      await h.store.grant(h.folderId, "grantee@x.com", h.existingUserId, h.existingUserId);
      const found = await h.store.findFor(h.folderId, {
        userId: h.existingUserId,
        email: "unrelated@x.com",
      });
      expect(found.ok && found.value?.granteeEmail).toBe("grantee@x.com");
    });

    it("a share with no resolved granteeUserId still matches by email only", async () => {
      await h.store.grant(h.folderId, "not-signed-up@x.com", h.existingUserId, null);
      const found = await h.store.findFor(h.folderId, {
        userId: STRANGER,
        email: "not-signed-up@x.com",
      });
      expect(found.ok && found.value?.granteeEmail).toBe("not-signed-up@x.com");
    });

    it("matches email normalized — case-insensitive and trimmed", async () => {
      await h.store.grant(h.folderId, "A@B.com", h.existingUserId, null);
      const found = await h.store.findFor(h.folderId, { userId: STRANGER, email: "  a@b.COM  " });
      expect(found.ok && found.value).not.toBeNull();
      await h.store.revoke(h.folderId, "  A@B.COM ");
      const after = await h.store.findFor(h.folderId, { userId: STRANGER, email: "a@b.com" });
      expect(after.ok && after.value).toBeNull();
    });

    it("grant upserts in place — no PK conflict on a re-share", async () => {
      await h.store.grant(h.folderId, "a@b.com", h.existingUserId, null);
      await h.store.grant(h.folderId, "a@b.com", h.existingUserId, h.existingUserId);
      const found = await h.store.findFor(h.folderId, { userId: STRANGER, email: "a@b.com" });
      expect(found.ok && found.value?.granteeUserId).toBe(h.existingUserId);
    });

    it("no match when neither userId nor email match anything shared", async () => {
      await h.store.grant(h.folderId, "a@b.com", h.existingUserId, null);
      const found = await h.store.findFor(h.folderId, { userId: STRANGER, email: "c@d.com" });
      expect(found.ok && found.value).toBeNull();
    });

    it("listByFolder returns every share on the folder", async () => {
      await h.store.grant(h.folderId, "a@b.com", h.existingUserId, null);
      await h.store.grant(h.folderId, "c@d.com", h.existingUserId, h.existingUserId);
      const listed = await h.store.listByFolder(h.folderId);
      expect(listed.ok && listed.value.map((s) => s.granteeEmail).sort()).toEqual([
        "a@b.com",
        "c@d.com",
      ]);
    });

    it("listByFolder is empty after every share is revoked", async () => {
      await h.store.grant(h.folderId, "a@b.com", h.existingUserId, null);
      await h.store.revoke(h.folderId, "a@b.com");
      const listed = await h.store.listByFolder(h.folderId);
      expect(listed.ok && listed.value).toEqual([]);
    });

    // ── Folder correlation ────────────────────────────────────────────────
    // Every assertion above uses ONE folder, so a store that dropped the
    // folder term entirely — matching purely on grantee — would satisfy them
    // all. These pin the correlation: a share is a share OF a folder.

    it("findFor does NOT match a share granted on a DIFFERENT folder", async () => {
      await h.store.grant(h.otherFolderId, "a@b.com", h.existingUserId, h.existingUserId);
      const byEmail = await h.store.findFor(h.folderId, {
        userId: STRANGER,
        email: "a@b.com",
      });
      expect(byEmail.ok && byEmail.value).toBeNull();
      const byUserId = await h.store.findFor(h.folderId, {
        userId: h.existingUserId,
        email: "unrelated@x.com",
      });
      expect(byUserId.ok && byUserId.value).toBeNull();
    });

    it("listByFolder returns only THIS folder's shares", async () => {
      await h.store.grant(h.folderId, "mine@b.com", h.existingUserId, null);
      await h.store.grant(h.otherFolderId, "theirs@b.com", h.existingUserId, null);
      const listed = await h.store.listByFolder(h.folderId);
      expect(listed.ok && listed.value.map((s) => s.granteeEmail)).toEqual(["mine@b.com"]);
    });

    it("revoke on one folder leaves the same grantee's share on another intact", async () => {
      await h.store.grant(h.folderId, "a@b.com", h.existingUserId, null);
      await h.store.grant(h.otherFolderId, "a@b.com", h.existingUserId, null);
      await h.store.revoke(h.folderId, "a@b.com");
      const survivor = await h.store.findFor(h.otherFolderId, {
        userId: STRANGER,
        email: "a@b.com",
      });
      expect(survivor.ok && survivor.value?.granteeEmail).toBe("a@b.com");
    });
  });
}

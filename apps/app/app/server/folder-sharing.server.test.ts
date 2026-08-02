import { describe, expect, it } from "vitest";
import {
  ADOPTION_NOTICE,
  cascadeSummary,
  folderManagement,
  folderVisibilityBadge,
  NON_OWNER_REASON,
  ROOT_REASON,
} from "./folder-sharing.server";

describe("folderVisibilityBadge (ADR-0076 sidebar badge)", () => {
  it("labels an org-visible folder 'Org'", () => {
    expect(folderVisibilityBadge({ visibility: "org", shareCount: 0 })).toEqual({
      label: "Org",
      tone: "warning",
    });
  });

  it("labels a private folder with no shares 'Private'", () => {
    expect(folderVisibilityBadge({ visibility: "private", shareCount: 0 })).toEqual({
      label: "Private",
      tone: "neutral",
    });
  });

  it("labels a private folder with shares 'Shared with N'", () => {
    expect(folderVisibilityBadge({ visibility: "private", shareCount: 3 })).toEqual({
      label: "Shared with 3",
      tone: "brand",
    });
  });

  it("singularises the share count", () => {
    expect(folderVisibilityBadge({ visibility: "private", shareCount: 1 }).label).toBe(
      "Shared with 1",
    );
  });

  it("falls back to Private when the share count was NOT loaded (null)", () => {
    // The loader only pays for a share roster on the folder being managed;
    // everywhere else the count is unknown and the badge must not invent one.
    expect(folderVisibilityBadge({ visibility: "private", shareCount: null }).label).toBe(
      "Private",
    );
  });

  it("keeps 'Org' even when a share roster exists — org visibility dominates", () => {
    expect(folderVisibilityBadge({ visibility: "org", shareCount: 4 }).label).toBe("Org");
  });
});

describe("folderManagement (mirrors loadManagedFolder, ADR-0076 §6)", () => {
  const me = "user-me";

  it("the Root is never manageable — the domain rejects any visibility call on it", () => {
    const m = folderManagement({ parentId: null, ownerId: null }, me);
    expect(m.isRoot).toBe(true);
    expect(m.manageable).toBe(false);
    expect(m.blockedReason).toBe(ROOT_REASON);
  });

  it("a Root that somehow carries an owner is STILL not manageable", () => {
    expect(folderManagement({ parentId: null, ownerId: me }, me).manageable).toBe(false);
  });

  it("the owner may manage their own folder, with no adoption notice", () => {
    const m = folderManagement({ parentId: "root", ownerId: me }, me);
    expect(m).toMatchObject({
      isRoot: false,
      manageable: true,
      legacy: false,
      blockedReason: null,
      adoptionNotice: null,
    });
  });

  it("a LEGACY folder (ownerId null) is manageable by anyone — and warns about adoption FIRST", () => {
    const m = folderManagement({ parentId: "root", ownerId: null }, me);
    expect(m.manageable).toBe(true);
    expect(m.legacy).toBe(true);
    expect(m.adoptionNotice).toBe(ADOPTION_NOTICE);
    expect(ADOPTION_NOTICE).toContain("You'll become this folder's owner");
    expect(ADOPTION_NOTICE).toContain("Other members won't be able to change its sharing");
  });

  it("a visible folder owned by SOMEONE ELSE is blocked, with the server's own reason", () => {
    const m = folderManagement({ parentId: "root", ownerId: "user-other" }, me);
    expect(m.manageable).toBe(false);
    expect(m.legacy).toBe(false);
    expect(m.blockedReason).toBe(NON_OWNER_REASON);
    expect(m.adoptionNotice).toBeNull();
  });

  it("an unresolved actor manages nothing (a signed-out/degraded dashboard render)", () => {
    expect(folderManagement({ parentId: "root", ownerId: null }, null).manageable).toBe(false);
    expect(folderManagement({ parentId: "root", ownerId: me }, null).manageable).toBe(false);
  });
});

describe("cascadeSummary (ADR-0076 §cascade — partial failure told honestly)", () => {
  it("reports the folder alone when no cascade was requested", () => {
    expect(
      cascadeSummary({ visibility: "private", changed: [], failed: [], cascaded: false }),
    ).toBe("Set to private.");
  });

  it("counts the descendants that actually changed", () => {
    expect(
      cascadeSummary({
        visibility: "private",
        changed: ["Specs", "Drafts"],
        failed: [],
        cascaded: true,
      }),
    ).toBe("Set to private, and applied to 2 folders inside: Specs, Drafts.");
  });

  it("says so when a cascade found nothing inside", () => {
    expect(cascadeSummary({ visibility: "org", changed: [], failed: [], cascaded: true })).toBe(
      "Set to org. Nothing inside this folder needed changing.",
    );
  });

  it("never claims success for a folder that failed — it names each one and why", () => {
    const summary = cascadeSummary({
      visibility: "private",
      changed: ["Specs"],
      failed: [{ name: "Ops", reason: "only the folder's owner can manage its sharing" }],
      cascaded: true,
    });
    expect(summary).toContain("applied to 1 folder inside: Specs");
    expect(summary).toContain("1 folder was NOT changed");
    expect(summary).toContain("Ops (only the folder's owner can manage its sharing)");
  });

  it("reports a total failure without any success claim at all", () => {
    const summary = cascadeSummary({
      visibility: "private",
      changed: [],
      failed: [
        { name: "Ops", reason: "denied" },
        { name: "Legal", reason: "denied" },
      ],
      cascaded: true,
    });
    expect(summary).toBe(
      "Set to private. 2 folders were NOT changed: Ops (denied), Legal (denied).",
    );
    expect(summary).not.toContain("applied to");
  });

  it("singularises both counts", () => {
    expect(
      cascadeSummary({ visibility: "org", changed: ["A"], failed: [], cascaded: true }),
    ).toContain("applied to 1 folder inside");
  });
});

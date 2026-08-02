import { describe, expect, it } from "vitest";
import { folderId, orgId, userId } from "./brand";
import {
  canWriteFolder,
  createFolder,
  type Folder,
  folderSlug,
  graftOrphansToRoot,
  inheritedVisibility,
  isFolderBroadlyVisibleTo,
  renameFolder,
  setFolderVisibility,
  visibleFolderOrRoot,
} from "./folder";

const org = orgId("00000000-0000-7000-8000-0000000000a1");
const parent = folderId("00000000-0000-7000-8000-0000000000f0");
const id = folderId("00000000-0000-7000-8000-0000000000f1");
const owner = userId("00000000-0000-7000-8000-0000000000e1");
const other = userId("00000000-0000-7000-8000-0000000000e2");

function build(overrides: Partial<Folder> = {}): Folder {
  return {
    id,
    orgId: org,
    parentId: parent,
    ownerId: owner,
    visibility: "private",
    name: "F",
    slug: "f",
    deletedAt: null,
    ...overrides,
  };
}

describe("createFolder", () => {
  it("creates a folder with a slug derived from the name", () => {
    const r = createFolder({
      id,
      orgId: org,
      parentId: parent,
      ownerId: owner,
      visibility: "private",
      name: "Q1 Reports",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      id,
      orgId: org,
      parentId: parent,
      ownerId: owner,
      visibility: "private",
      name: "Q1 Reports",
      slug: "q1-reports",
      deletedAt: null,
    });
  });

  it("supports a top-level folder (parentId null) and a legacy null owner", () => {
    const r = createFolder({
      id,
      orgId: org,
      parentId: null,
      ownerId: null,
      visibility: "org",
      name: "Archive",
    });
    expect(r.ok && r.value.parentId).toBeNull();
    expect(r.ok && r.value.ownerId).toBeNull();
    expect(r.ok && r.value.visibility).toBe("org");
    expect(r.ok && r.value.slug).toBe("archive");
  });

  it("trims the name and rejects an empty one", () => {
    const base = { id, orgId: org, parentId: null, ownerId: owner, visibility: "org" } as const;
    expect(createFolder({ ...base, name: "   " }).ok).toBe(false);
    const r = createFolder({ ...base, name: "  Docs  " });
    expect(r.ok && r.value.name).toBe("Docs");
  });

  it("rejects a name with no alphanumeric characters", () => {
    const r = createFolder({
      id,
      orgId: org,
      parentId: null,
      ownerId: owner,
      visibility: "org",
      name: "///",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("ValidationError");
  });
});

describe("folderSlug", () => {
  it("lowercases, hyphenates runs of non-alphanumerics, and trims hyphens", () => {
    expect(folderSlug("2024 — Q1 / Final!!")).toBe("2024-q1-final");
  });
});

describe("renameFolder", () => {
  const folder = build({ name: "Old", slug: "old" });

  it("updates the display name and trims it, keeping the slug stable", () => {
    const r = renameFolder(folder, "  New Name  ");
    expect(r.ok && r.value.name).toBe("New Name");
    expect(r.ok && r.value.slug).toBe("old"); // slug unchanged
  });

  it("rejects an empty name", () => {
    const r = renameFolder(folder, "   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });
});

describe("inheritedVisibility (ADR-0076)", () => {
  it("a child of the Root (parent.parentId null) defaults private", () => {
    const root = build({ parentId: null, ownerId: null, visibility: "org" });
    expect(inheritedVisibility(root)).toBe("private");
  });

  it("a child of a non-root folder inherits its parent's visibility", () => {
    expect(inheritedVisibility(build({ visibility: "org" }))).toBe("org");
    expect(inheritedVisibility(build({ visibility: "private" }))).toBe("private");
  });
});

describe("setFolderVisibility (ADR-0076)", () => {
  it("flips visibility and keeps an existing owner", () => {
    const r = setFolderVisibility(build({ visibility: "private" }), "org", other);
    expect(r.ok && r.value.visibility).toBe("org");
    expect(r.ok && r.value.ownerId).toBe(owner); // NOT adopted — already owned
  });

  it("ADOPTS a legacy (ownerId null) folder: the claimant becomes owner", () => {
    const r = setFolderVisibility(build({ ownerId: null, visibility: "org" }), "private", other);
    expect(r.ok && r.value.ownerId).toBe(other);
    expect(r.ok && r.value.visibility).toBe("private");
  });

  it("rejects making the Root private (root-always-org invariant)", () => {
    const root = build({ parentId: null, ownerId: null, visibility: "org" });
    const r = setFolderVisibility(root, "private", other);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects re-asserting org on the Root — the Root is not a manageable folder", () => {
    const root = build({ parentId: null, ownerId: null, visibility: "org" });
    const r = setFolderVisibility(root, "org", other);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("NEVER adopts the Root: a legacy Root stays ownerless and org after any attempt", () => {
    const root = build({ parentId: null, ownerId: null, visibility: "org" });
    for (const visibility of ["org", "private"] as const) {
      const r = setFolderVisibility(root, visibility, other);
      expect(r.ok).toBe(false);
    }
    // The pure transition never mutates, so the Root the caller holds is
    // untouched — no owner was seized, visibility is still org.
    expect(root.ownerId).toBeNull();
    expect(root.visibility).toBe("org");
  });

  it("refuses to adopt an ALREADY-OWNED Root too (defence in depth)", () => {
    const seized = build({ parentId: null, ownerId: owner, visibility: "org" });
    expect(setFolderVisibility(seized, "org", other).ok).toBe(false);
  });
});

describe("visibility + write predicates (ADR-0076)", () => {
  it("owner sees and writes their private folder; others do neither", () => {
    const f = build({ visibility: "private" });
    expect(isFolderBroadlyVisibleTo(f, owner)).toBe(true);
    expect(canWriteFolder(f, owner)).toBe(true);
    expect(isFolderBroadlyVisibleTo(f, other)).toBe(false);
    expect(canWriteFolder(f, other)).toBe(false);
  });

  it("legacy (ownerId null) folders stay visible + writable to everyone", () => {
    const f = build({ ownerId: null, visibility: "org" });
    expect(isFolderBroadlyVisibleTo(f, other)).toBe(true);
    expect(canWriteFolder(f, other)).toBe(true);
  });

  it("org-visible folders are visible + writable to any org member", () => {
    const f = build({ visibility: "org" });
    expect(isFolderBroadlyVisibleTo(f, other)).toBe(true);
    expect(canWriteFolder(f, other)).toBe(true);
  });
});

describe("graftOrphansToRoot (ADR-0076)", () => {
  const root = { id: "root", parentId: null };

  it("re-parents a visible folder whose parent is missing (invisible) to the Root", () => {
    const orphan = { id: "c", parentId: "invisible-parent" };
    const grafted = graftOrphansToRoot([root, orphan], "root");
    expect(grafted).toEqual([root, { id: "c", parentId: "root" }]);
  });

  it("keeps a chain intact when the parent IS visible (only the top grafts)", () => {
    const mid = { id: "m", parentId: "invisible" };
    const leaf = { id: "l", parentId: "m" };
    const grafted = graftOrphansToRoot([root, mid, leaf], "root");
    expect(grafted).toEqual([root, { id: "m", parentId: "root" }, leaf]);
  });

  it("is identity on a fully-visible tree", () => {
    const a = { id: "a", parentId: "root" };
    const b = { id: "b", parentId: "a" };
    expect(graftOrphansToRoot([root, a, b], "root")).toEqual([root, a, b]);
  });

  it("preserves extra node fields (generic over the node shape)", () => {
    const named = { id: "x", parentId: "gone", name: "Kept" };
    const grafted = graftOrphansToRoot([{ ...root, name: "Root" }, named], "root");
    expect(grafted[1]).toEqual({ id: "x", parentId: "root", name: "Kept" });
  });

  // ── Degenerate parent links (F12) ───────────────────────────────────────
  // A cycle can only reach the tree through corrupt data, but the renderer
  // must not be the thing that discovers it: an unrooted node is grafted to
  // the Root (reachable, nothing silently vanishes) rather than left to spin
  // a parent walk forever.

  it("grafts a SELF-PARENTED node to the Root instead of leaving it unreachable", () => {
    const self = { id: "s", parentId: "s" };
    expect(graftOrphansToRoot([root, self], "root")).toEqual([root, { id: "s", parentId: "root" }]);
  });

  it("grafts every member of a CYCLE among visible nodes — the tree never loops", () => {
    const a = { id: "a", parentId: "b" };
    const b = { id: "b", parentId: "a" };
    expect(graftOrphansToRoot([root, a, b], "root")).toEqual([
      root,
      { id: "a", parentId: "root" },
      { id: "b", parentId: "root" },
    ]);
  });

  it("grafts a node whose ancestor chain LEADS INTO a cycle", () => {
    const a = { id: "a", parentId: "b" };
    const b = { id: "b", parentId: "a" };
    const leaf = { id: "l", parentId: "a" };
    const grafted = graftOrphansToRoot([root, a, b, leaf], "root");
    expect(grafted.map((n) => n.parentId)).toEqual([null, "root", "root", "root"]);
  });

  it("is a stable no-op when rootId is ABSENT from the node set", () => {
    const child = { id: "c", parentId: "root" };
    const once = graftOrphansToRoot([child], "root");
    expect(once).toEqual([child]);
    expect(graftOrphansToRoot(once, "root")).toEqual([child]);
  });
});

describe("visibleFolderOrRoot (ADR-0076)", () => {
  const nodes = [
    { id: "root", parentId: null },
    { id: "a", parentId: "root" },
  ];

  it("returns the folder id unchanged when it IS among the visible nodes", () => {
    expect(visibleFolderOrRoot("a", nodes, "root")).toBe("a");
  });

  it("falls back to the Root when the folder is invisible to this viewer", () => {
    expect(visibleFolderOrRoot("hidden", nodes, "root")).toBe("root");
  });

  it("falls back for the Root's own id when the Root itself is not rendered", () => {
    expect(visibleFolderOrRoot("hidden", [], "root")).toBe("root");
  });
});

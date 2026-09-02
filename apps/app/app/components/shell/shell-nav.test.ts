// Pure-logic tests for the app shell's navigation helpers (#333). No DOM: the
// shell is prop-driven, so its load-bearing logic is plain functions — the
// folder-tree build, the folder breadcrumb path, the active-nav predicate, and
// the rail-collapse keyboard match.
import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  crumbsFor,
  folderTrail,
  isNavActive,
  isRailToggle,
  type NavFolder,
} from "./shell-nav";

const folders: NavFolder[] = [
  { id: "root", parentId: null, name: "Root" },
  { id: "q3", parentId: "root", name: "Q3 planning" },
  { id: "cr", parentId: "q3", name: "Customer research" },
  { id: "design", parentId: "root", name: "Design" },
];

describe("buildFolderTree", () => {
  it("nests a flat list by parentId, roots first", () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((n) => n.id)).toEqual(["root"]);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(["q3", "design"]);
    expect(tree[0]?.children[0]?.children.map((n) => n.id)).toEqual(["cr"]);
  });
  it("does not lose an orphan whose parent is absent (grafts to top level)", () => {
    const tree = buildFolderTree([{ id: "x", parentId: "gone", name: "X" }]);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });
});

describe("folderTrail", () => {
  it("returns root→…→selected for a nested folder", () => {
    expect(folderTrail(folders, "cr").map((f) => f.name)).toEqual([
      "Root",
      "Q3 planning",
      "Customer research",
    ]);
  });
  it("is empty for an unknown or null selection", () => {
    expect(folderTrail(folders, null)).toEqual([]);
    expect(folderTrail(folders, "nope")).toEqual([]);
  });
});

describe("isNavActive", () => {
  it("matches the dashboard root exactly, not every path", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/upload", "/")).toBe(false);
  });
  it("matches a section by prefix", () => {
    expect(isNavActive("/settings/api-keys", "/settings")).toBe(true);
    expect(isNavActive("/settings", "/settings")).toBe(true);
  });
});

describe("isRailToggle", () => {
  it("is the meta/ctrl+B chord, nothing else", () => {
    expect(isRailToggle({ key: "b", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isRailToggle({ key: "B", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isRailToggle({ key: "b", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isRailToggle({ key: "k", metaKey: true, ctrlKey: false })).toBe(false);
  });
});

describe("crumbsFor", () => {
  it("dashboard root is just Reports", () => {
    expect(crumbsFor("/", folders, null)).toEqual([{ label: "Reports" }]);
  });
  it("a selected folder extends Reports with its ancestor-linked trail", () => {
    const c = crumbsFor("/", folders, "cr");
    expect(c.map((x) => x.label)).toEqual(["Reports", "Root", "Q3 planning", "Customer research"]);
    expect(c[0]?.href).toBe("/"); // ancestors link
    expect(c.at(-1)?.href).toBeUndefined(); // current is plain
  });
  it("upload and settings get their own trails", () => {
    expect(crumbsFor("/upload", folders, null).map((x) => x.label)).toEqual(["Reports", "Upload"]);
    expect(crumbsFor("/settings/api-keys", folders, null).map((x) => x.label)).toEqual([
      "Settings",
      "API keys",
    ]);
  });
});

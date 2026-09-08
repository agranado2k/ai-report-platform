import { describe, expect, it } from "vitest";
import {
  buildPaletteItems,
  filterPalette,
  isPaletteOpenChord,
  moveActiveIndex,
  opensInNewTab,
} from "./command-palette";

// Pure model for the ⌘K command palette (#336, report Z0W60dI8hu §08). No DOM —
// the item list, the filter/rank, the open chord (⌘K in the app, ⌘⌥K in the
// editor) and the ⌘Enter "new tab" read are all decisions the component only
// renders, so they live here in the fast node tier.

const reports = [
  { slug: "q3-roadmap", title: "Q3 roadmap review" },
  { slug: "hiring-plan", title: "Q3 hiring plan" },
];
const folders = [
  { id: "root", name: "Root" },
  { id: "q3", name: "Q3 planning" },
];

describe("buildPaletteItems", () => {
  it("lists the three global actions, then reports, then folders", () => {
    const items = buildPaletteItems({ reports, folders });
    const groups = items.map((i) => i.group);
    // actions come first (a fresh palette leads with what you can DO), then the
    // objects you can jump to.
    expect(groups.indexOf("actions")).toBeLessThan(groups.indexOf("reports"));
    expect(groups.indexOf("reports")).toBeLessThan(groups.indexOf("folders"));
    const actions = items.filter((i) => i.group === "actions").map((i) => i.action);
    expect(actions).toEqual(["upload", "new-folder", "copy-mcp"]);
  });

  it("makes report items open the owner-open route and honour a new tab", () => {
    const items = buildPaletteItems({ reports, folders });
    const roadmap = items.find((i) => i.id === "report:q3-roadmap");
    expect(roadmap).toMatchObject({
      group: "reports",
      label: "Q3 roadmap review",
      hint: "q3-roadmap",
      href: "/reports/q3-roadmap/open",
      newTab: true,
    });
  });

  it("makes folder items filter the dashboard to that folder", () => {
    const items = buildPaletteItems({ reports, folders });
    const q3 = items.find((i) => i.id === "folder:q3");
    expect(q3).toMatchObject({ group: "folders", label: "Q3 planning", href: "/?folder=q3" });
  });
});

describe("filterPalette", () => {
  const items = buildPaletteItems({ reports, folders });

  it("returns every item for an empty query (grouped order preserved)", () => {
    expect(filterPalette(items, "")).toHaveLength(items.length);
    expect(filterPalette(items, "   ")).toHaveLength(items.length);
  });

  it("matches on label and hint, case-insensitively", () => {
    const hits = filterPalette(items, "roadmap");
    expect(hits.map((i) => i.id)).toContain("report:q3-roadmap");
    expect(hits.every((i) => i.id !== "report:hiring-plan")).toBe(true);
  });

  it("matches a report by its slug hint", () => {
    const hits = filterPalette(items, "hiring-plan");
    expect(hits.map((i) => i.id)).toContain("report:hiring-plan");
  });

  it("ranks a label prefix above a mid-string match", () => {
    const hits = filterPalette(items, "q3");
    // "Q3 roadmap review" / "Q3 hiring plan" / "Q3 planning" all start with Q3;
    // the copy-mcp action ("Copy MCP endpoint") does not — it must not outrank
    // a prefix hit, and a non-match ("Upload a report") drops out entirely.
    expect(hits[0]?.label.toLowerCase().startsWith("q3")).toBe(true);
    expect(hits.some((i) => i.action === "upload")).toBe(false);
  });
});

describe("isPaletteOpenChord", () => {
  const base = { key: "k", metaKey: false, ctrlKey: false, altKey: false };
  it("opens on ⌘K / Ctrl+K in the app (no alt)", () => {
    expect(isPaletteOpenChord({ ...base, metaKey: true }, { inEditor: false })).toBe(true);
    expect(isPaletteOpenChord({ ...base, ctrlKey: true }, { inEditor: false })).toBe(true);
  });
  it("does NOT open on ⌘K in the editor — there ⌘K is the link shortcut", () => {
    expect(isPaletteOpenChord({ ...base, metaKey: true }, { inEditor: true })).toBe(false);
  });
  it("opens on ⌘⌥K in the editor, and only there", () => {
    expect(isPaletteOpenChord({ ...base, metaKey: true, altKey: true }, { inEditor: true })).toBe(
      true,
    );
    // In the app ⌘⌥K is not the palette chord (it's plain ⌘K).
    expect(isPaletteOpenChord({ ...base, metaKey: true, altKey: true }, { inEditor: false })).toBe(
      false,
    );
  });
  it("ignores other keys and unmodified k", () => {
    expect(isPaletteOpenChord({ ...base, key: "j", metaKey: true }, { inEditor: false })).toBe(
      false,
    );
    expect(isPaletteOpenChord(base, { inEditor: false })).toBe(false);
  });
  it("is case-insensitive on the key (a held Shift uppercases it)", () => {
    expect(isPaletteOpenChord({ ...base, key: "K", metaKey: true }, { inEditor: false })).toBe(
      true,
    );
  });
});

describe("moveActiveIndex", () => {
  it("wraps forward and backward over the list", () => {
    expect(moveActiveIndex(0, 1, 3)).toBe(1);
    expect(moveActiveIndex(2, 1, 3)).toBe(0); // wrap to top
    expect(moveActiveIndex(0, -1, 3)).toBe(2); // wrap to bottom
  });
  it("clamps to 0 for an empty list", () => {
    expect(moveActiveIndex(0, 1, 0)).toBe(0);
  });
});

describe("opensInNewTab", () => {
  it("is true only when a modifier is held on Enter (⌘Enter / Ctrl+Enter)", () => {
    expect(opensInNewTab({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(opensInNewTab({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(opensInNewTab({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

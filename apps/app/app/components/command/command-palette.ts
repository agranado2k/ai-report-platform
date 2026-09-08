// Pure model for the ⌘K command palette (#336, report Z0W60dI8hu §08). No DOM,
// no React — kept separate from the island so the load-bearing logic (the item
// list, the filter/rank, the open chord, the ⌘Enter read, and the wrapping
// arrow-key nav) is unit-testable in the fast node tier, the same split the
// shell nav (shell-nav.ts) and the dashboard filter (report-filter.ts) use.

/** The three groups the palette renders, in the order they appear. */
export type PaletteGroup = "actions" | "reports" | "folders";

/** The global actions the palette exposes (report §08). `copy-mcp` is a
 *  clipboard write; the other two navigate / open a dialog — the island maps
 *  each id to its handler. A closed enum so a typo can't invent an action. */
export type PaletteActionId = "upload" | "new-folder" | "copy-mcp";

export interface PaletteReport {
  readonly slug: string;
  readonly title: string;
}

export interface PaletteFolder {
  readonly id: string;
  readonly name: string;
}

export interface PaletteItem {
  /** Stable React key + lookup id, namespaced by kind (`report:<slug>`). */
  readonly id: string;
  readonly group: PaletteGroup;
  /** Primary line. */
  readonly label: string;
  /** Secondary line (a report's slug, an action's affordance) — also searched. */
  readonly hint?: string;
  /** Present → selecting navigates here (an action may also carry an href). */
  readonly href?: string;
  /** Present → selecting fires this global action. */
  readonly action?: PaletteActionId;
  /** A report row honours ⌘Enter to open in a new tab. */
  readonly newTab?: boolean;
}

const ACTIONS: readonly PaletteItem[] = [
  {
    id: "action:upload",
    group: "actions",
    label: "Upload a report",
    href: "/upload",
    action: "upload",
  },
  { id: "action:new-folder", group: "actions", label: "New folder", action: "new-folder" },
  { id: "action:copy-mcp", group: "actions", label: "Copy MCP endpoint", action: "copy-mcp" },
];

/** The full, unfiltered palette: the three global actions, then reports, then
 *  folders. Grouped in that order because a fresh palette leads with what you
 *  can DO before the objects you can jump to. */
export function buildPaletteItems(input: {
  readonly reports: readonly PaletteReport[];
  readonly folders: readonly PaletteFolder[];
}): PaletteItem[] {
  const reports: PaletteItem[] = input.reports.map((r) => ({
    id: `report:${r.slug}`,
    group: "reports",
    label: r.title,
    hint: r.slug,
    href: `/reports/${r.slug}/open`,
    newTab: true,
  }));
  const folders: PaletteItem[] = input.folders.map((f) => ({
    id: `folder:${f.id}`,
    group: "folders",
    label: f.name,
    href: `/?folder=${f.id}`,
  }));
  return [...ACTIONS, ...reports, ...folders];
}

/** Score an item against a lowercased query, or -1 for no match. A label prefix
 *  outranks a mid-label match, which outranks a hint-only match, so the most
 *  likely target floats to the top of the list. */
function scoreItem(item: PaletteItem, q: string): number {
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if (item.hint?.toLowerCase().includes(q)) return 1;
  return -1;
}

/** Filter + rank the palette for a query. Empty/whitespace query → the full
 *  list in grouped order. Otherwise: keep matches, sort by score (descending),
 *  ties broken by original order so a group's internal order is stable. */
export function filterPalette(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, q) }))
    .filter((e) => e.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((e) => e.item);
}

/** The palette open chord. In the app it is ⌘K / Ctrl+K (no Alt). In the editor
 *  ⌘K stays the link shortcut, so the palette moves to ⌘⌥K — the way GitHub
 *  resolves the same clash (report §08). Case-insensitive on the key so a held
 *  Shift (which uppercases it) still triggers. */
export function isPaletteOpenChord(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  opts: { inEditor: boolean },
): boolean {
  if (e.key.toLowerCase() !== "k") return false;
  if (!(e.metaKey || e.ctrlKey)) return false;
  return opts.inEditor ? e.altKey : !e.altKey;
}

/** Wrapping move through the filtered list (↑/↓). `delta` is +1 / -1; the list
 *  wraps at both ends. An empty list stays at 0 (nothing to select). */
export function moveActiveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

/** ⌘Enter / Ctrl+Enter on a report row opens it in a new tab (report §08). */
export function opensInNewTab(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey;
}

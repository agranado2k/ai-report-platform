// Pure navigation helpers for the app shell (#333). No DOM, no React — kept
// separate from the presentational components so the load-bearing logic is
// unit-testable in the fast node tier (the shell itself is prop-driven).

/** Client-safe folder shape for the sidebar NAV tree — id, parent, name only.
 *  Deliberately NOT the dashboard's heavyweight FolderNode (share state,
 *  roster, counts): the rail navigates, the dashboard body manages. */
export interface NavFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

export interface NavTreeNode extends NavFolder {
  readonly children: NavTreeNode[];
}

/** Flat visible-folder list → nested tree, top level first, source order kept.
 *  A folder whose parent is absent from the list (its ancestors are invisible
 *  to this viewer — already grafted server-side by visibleFolderTree) is
 *  treated as top level so it is never dropped. */
export function buildFolderTree(folders: readonly NavFolder[]): NavTreeNode[] {
  const byId = new Map<string, NavTreeNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const top: NavTreeNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.id);
    if (!node) continue;
    const parent = f.parentId ? byId.get(f.parentId) : undefined;
    if (parent) parent.children.push(node);
    else top.push(node); // root, or an orphan whose parent is not visible
  }
  return top;
}

/** Root→…→selected chain for breadcrumbs. Empty when the selection is null or
 *  not in the visible set (never guess a trail we can't see). */
export function folderTrail(folders: readonly NavFolder[], selectedId: string | null): NavFolder[] {
  if (!selectedId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const trail: NavFolder[] = [];
  let cursor: string | null = selectedId;
  const seen = new Set<string>(); // cycle guard — malformed data must not loop
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) return []; // a broken link anywhere → no partial trail
    trail.unshift(node);
    cursor = node.parentId;
  }
  return trail;
}

/** Is a primary-nav item active for the current path? The dashboard root ("/")
 *  matches only itself; a section ("/settings") matches its subtree by prefix. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The rail-collapse chord: ⌘B (mac) / Ctrl+B (win/linux), case-insensitive. */
export function isRailToggle(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key.toLowerCase() === "b" && (e.metaKey || e.ctrlKey);
}

export interface Crumb {
  readonly label: string;
  /** Absent on the current (last) crumb — it renders as plain text. */
  readonly href?: string;
}

/** Breadcrumb trail for a path. The dashboard ("/") is "Reports", extended by
 *  the selected folder's trail (each an ancestor link, the folder itself
 *  current). Other sections get their own two-level trail. Pure — the shell
 *  passes the result to <Breadcrumbs>. */
export function crumbsFor(
  pathname: string,
  folders: readonly NavFolder[],
  selectedFolderId: string | null,
): Crumb[] {
  if (pathname === "/") {
    const trail = folderTrail(folders, selectedFolderId);
    if (trail.length === 0) return [{ label: "Reports" }];
    return [
      { label: "Reports", href: "/" },
      ...trail.map((f, i) =>
        i === trail.length - 1 ? { label: f.name } : { label: f.name, href: `/?folder=${f.id}` },
      ),
    ];
  }
  if (pathname.startsWith("/upload")) return [{ label: "Reports", href: "/" }, { label: "Upload" }];
  if (pathname.startsWith("/settings")) return [{ label: "Settings" }, { label: "API keys" }];
  return [{ label: "Reports", href: "/" }];
}

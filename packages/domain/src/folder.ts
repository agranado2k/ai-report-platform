// Folder — the organizing aggregate root for Reports (ADR-0036, Reports &
// Folders). A tree inside an Org: each Folder has an optional parent (null =
// top-level / Root) and a `slug` unique among its siblings. Pure + immutable
// (ADR-0024); persistence + the sibling-uniqueness constraint live in adapters.
//
// Creator-owned visibility (ADR-0076, reverses ADR-0059 §5): a Folder carries
// an `ownerId` (the creating User; null = legacy pre-ADR-0076 rows) and a
// `visibility` (`private` = creator + folder-share grantees only; `org` =
// every org member). The Root folder is ALWAYS `org` (invariant — it must
// stay usable by every member for default uploads).
import type { FolderId, OrgId, UserId } from "./brand";
import type { AppError } from "./errors";
import { validationError } from "./errors";
import type { Result } from "./result";
import { err, ok } from "./result";

/** Who may see a Folder (ADR-0076): `private` = its owner + folder-share
 *  grantees; `org` = every member of its org. Legacy rows (ownerId null) read
 *  as visible-to-all regardless. */
export const FOLDER_VISIBILITIES = ["private", "org"] as const;
export type FolderVisibility = (typeof FOLDER_VISIBILITIES)[number];

/** The Root folder's visibility — ALWAYS `org` (ADR-0076 §3), because every
 *  member's default uploads land there. The `folders.visibility` column
 *  defaults to the fail-safe `private`, so every place that provisions or
 *  seeds a Root must write this EXPLICITLY; naming it keeps the three call
 *  sites from drifting apart. `setFolderVisibility` refuses to change it. */
export const ROOT_FOLDER_VISIBILITY: FolderVisibility = "org";

export interface Folder {
  readonly id: FolderId;
  readonly orgId: OrgId;
  /** The parent folder, or null for a top-level folder (the Root is parentId null). */
  readonly parentId: FolderId | null;
  /** The creating user (ADR-0076), or null for a legacy (pre-ADR-0076) folder —
   *  legacy folders stay visible + writable to the whole org (the backfill
   *  preserves the ADR-0059 behavior exactly). */
  readonly ownerId: UserId | null;
  /** Who may see this folder (ADR-0076). Root is always `org` (invariant). */
  readonly visibility: FolderVisibility;
  readonly name: string;
  /** URL-safe segment derived from the name; unique among siblings (DB-enforced). */
  readonly slug: string;
  readonly deletedAt: number | null;
}

export interface CreateFolderParams {
  readonly id: FolderId;
  readonly orgId: OrgId;
  readonly parentId: FolderId | null;
  readonly ownerId: UserId | null;
  readonly visibility: FolderVisibility;
  readonly name: string;
}

const MAX_NAME = 100;

/** A URL-safe folder slug from a display name: lowercased, non-alphanumerics → hyphens. */
export function folderSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Create a Folder under a parent (or top-level when parentId is null). */
export function createFolder(p: CreateFolderParams): Result<Folder, AppError> {
  const name = p.name.trim();
  if (name.length === 0) return err(validationError("folder name is required", "name"));
  if (name.length > MAX_NAME) {
    return err(validationError(`folder name too long (max ${MAX_NAME})`, "name"));
  }
  const slug = folderSlug(name);
  if (slug.length === 0) {
    return err(validationError("folder name must contain a letter or digit", "name"));
  }
  return ok({
    id: p.id,
    orgId: p.orgId,
    parentId: p.parentId,
    ownerId: p.ownerId,
    visibility: p.visibility,
    name,
    slug,
    deletedAt: null,
  });
}

/** The visibility a NEW child folder starts with (ADR-0076): a child of the
 *  Root defaults `private` (the private-by-default rule — Root's own `org`
 *  visibility is a usability invariant, not a sharing intent); a child of any
 *  other folder inherits its parent's visibility at creation. */
export function inheritedVisibility(parent: Folder): FolderVisibility {
  return parent.parentId === null ? "private" : parent.visibility;
}

/** Set a Folder's visibility (ADR-0076). A legacy folder (ownerId null) is
 *  ADOPTED by the claimant: setting its visibility assigns them as owner (the
 *  repair path for pre-ADR-0076 org-visible folders); an already-owned folder
 *  keeps its owner.
 *
 *  The ROOT (parentId null) is never manageable — EITHER direction is rejected.
 *  Rejecting Root→private alone would leave Root→org as a seizure: the Root is
 *  a legacy row (ownerId null), so the adoption leg would hand the caller
 *  permanent ownership of everyone's default upload placement and 403 every
 *  other member out of managing it. Re-asserting `org` on a Root is a no-op in
 *  visibility terms anyway, so nothing legitimate is lost by refusing it. */
export function setFolderVisibility(
  folder: Folder,
  visibility: FolderVisibility,
  claimant: UserId,
): Result<Folder, AppError> {
  if (folder.parentId === null) {
    return err(
      validationError("the Root folder is always org-visible and cannot be owned", "visibility"),
    );
  }
  return ok({ ...folder, visibility, ownerId: folder.ownerId ?? claimant });
}

/** The pure (share-free) legs of the folder visibility predicate (ADR-0076):
 *  owner, legacy (ownerId null), or org-visible. The folder-share leg needs
 *  the FolderShareStore and lives in the application layer. Callers have
 *  already established the org scope. */
export function isFolderBroadlyVisibleTo(folder: Folder, userId: UserId): boolean {
  return folder.ownerId === null || folder.ownerId === userId || folder.visibility === "org";
}

/** May `userId` MODIFY this folder (rename / delete / create children inside
 *  it) — ADR-0076 §write-semantics: its owner, or anyone in the org for a
 *  legacy (ownerId null) or org-visible folder (today's behavior preserved).
 *  Exactly the broad-visibility legs BY DESIGN — folder shares grant
 *  VISIBILITY only, never write, so the share leg is the one thing that
 *  separates "can see" from "can modify". Callers have already established
 *  the org scope. */
export function canWriteFolder(folder: Folder, userId: UserId): boolean {
  return isFolderBroadlyVisibleTo(folder, userId);
}

/** A node in a parent-linked tree, as the graft helper sees it — works for
 *  both domain Folders (branded ids) and wire FolderNodes (string ids). */
export interface TreeNodeRef {
  readonly id: string;
  readonly parentId: string | null;
}

/** Graft visibility orphans under the Root (ADR-0076 §partial-visibility): a
 *  visible folder whose parent is NOT in the visible set (an invisible
 *  ancestor) is re-parented to `rootId` for TREE RENDERING, so it stays
 *  reachable without leaking any invisible ancestor's name. Pure; the input
 *  order is preserved; nodes with a visible parent are untouched.
 *
 *  A node whose ancestor chain CYCLES (including a self-parent) is grafted for
 *  the same reason: it can never reach the Root, so leaving it alone would
 *  either drop it from the render or spin a parent walk forever. Corrupt data
 *  should surface as a folder sitting oddly at the top level, never as a hung
 *  or truncated sidebar. `rootId` need not be present in `nodes` — grafting is
 *  idempotent either way. */
export function graftOrphansToRoot<T extends TreeNodeRef>(
  nodes: readonly T[],
  rootId: string,
): readonly T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => (isUnrooted(n, byId) ? { ...n, parentId: rootId } : n));
}

/** Resolve a folder reference for RENDERING (ADR-0076 §partial-visibility).
 *  A visible report can live in a folder this viewer cannot see, so its
 *  `folderId` is not among the visible nodes. Fall back to `rootId` — the same
 *  place `graftOrphansToRoot` puts orphaned subtrees — so anything BOUND to
 *  that id (a folder-name label, a Move control's selected option) points at a
 *  folder that is actually on screen. Getting this wrong on a form control is
 *  not cosmetic: a `<select>` whose value matches no option preselects the
 *  first one, so submitting the form untouched silently moves the report. */
export function visibleFolderOrRoot<T extends TreeNodeRef>(
  folderId: string,
  nodes: readonly T[],
  rootId: string,
): string {
  return nodes.some((n) => n.id === folderId) ? folderId : rootId;
}

/** Can `node` NOT reach a top-level ancestor by following parent links? True
 *  when its immediate parent is missing from the set (the invisible-ancestor
 *  case) or when walking up revisits a node (a cycle). A chain that ends at an
 *  absent ANCESTOR is fine: that ancestor is itself grafted, which re-roots the
 *  whole chain below it. */
function isUnrooted<T extends TreeNodeRef>(node: T, byId: ReadonlyMap<string, T>): boolean {
  if (node.parentId === null) return false;
  const parent = byId.get(node.parentId);
  if (!parent) return true;
  const seen = new Set<string>([node.id]);
  let current: T | undefined = parent;
  while (current) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    if (current.parentId === null) return false;
    current = byId.get(current.parentId);
  }
  return false;
}

/** Rename a Folder (display name only; the slug stays stable so sibling-slug
 * uniqueness and any folder references are unaffected). Pure transition. */
export function renameFolder(folder: Folder, name: string): Result<Folder, AppError> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return err(validationError("folder name is required", "name"));
  if (trimmed.length > MAX_NAME) {
    return err(validationError(`folder name too long (max ${MAX_NAME})`, "name"));
  }
  return ok({ ...folder, name: trimmed });
}

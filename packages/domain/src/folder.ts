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

/** Set a Folder's visibility (ADR-0076). The Root is always `org` — flipping
 *  it private is rejected. A legacy folder (ownerId null) is ADOPTED by the
 *  claimant: setting its visibility assigns them as owner (the repair path for
 *  pre-ADR-0076 org-visible folders); an already-owned folder keeps its owner. */
export function setFolderVisibility(
  folder: Folder,
  visibility: FolderVisibility,
  claimant: UserId,
): Result<Folder, AppError> {
  if (folder.parentId === null && visibility === "private") {
    return err(validationError("the Root folder is always org-visible", "visibility"));
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
 *  order is preserved; nodes with a visible parent are untouched. */
export function graftOrphansToRoot<T extends TreeNodeRef>(
  nodes: readonly T[],
  rootId: string,
): readonly T[] {
  const present = new Set(nodes.map((n) => n.id));
  return nodes.map((n) =>
    n.parentId !== null && !present.has(n.parentId) ? { ...n, parentId: rootId } : n,
  );
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

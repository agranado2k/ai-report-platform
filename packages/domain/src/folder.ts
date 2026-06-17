// Folder — the organizing aggregate root for Reports (ADR-0036, Reports &
// Folders). A tree inside an Org: each Folder has an optional parent (null =
// top-level / Root) and a `slug` unique among its siblings. Pure + immutable
// (ADR-0024); persistence + the sibling-uniqueness constraint live in adapters.
import type { FolderId, OrgId } from "./brand";
import type { AppError } from "./errors";
import { validationError } from "./errors";
import type { Result } from "./result";
import { err, ok } from "./result";

export interface Folder {
  readonly id: FolderId;
  readonly orgId: OrgId;
  /** The parent folder, or null for a top-level folder (the Root is parentId null). */
  readonly parentId: FolderId | null;
  readonly name: string;
  /** URL-safe segment derived from the name; unique among siblings (DB-enforced). */
  readonly slug: string;
  readonly deletedAt: number | null;
}

export interface CreateFolderParams {
  readonly id: FolderId;
  readonly orgId: OrgId;
  readonly parentId: FolderId | null;
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
  return ok({ id: p.id, orgId: p.orgId, parentId: p.parentId, name, slug, deletedAt: null });
}

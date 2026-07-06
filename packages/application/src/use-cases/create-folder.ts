// createFolder — create a Folder under a parent in the acting org (ADR-0036,
// Reports & Folders). Pure orchestration over FolderRepository + IdGenerator
// (ADR-0024). Invariants enforced here:
//   - the parent must exist, not be soft-deleted, and belong to the actor's org
//     (the shared loadOwnedFolder tenancy guard — issue #132);
//   - a parent is REQUIRED — the single org Root (parent_id NULL) is created at
//     provisioning, never via this use case, so we can't mint a second Root;
//   - max nesting depth 8 (docs/db-design.md, ADR-0037), Root = depth 0.
// Sibling-slug uniqueness is DB-enforced; a clash surfaces as a ValidationError.
import {
  type AppError,
  createFolder as buildFolder,
  err,
  type Folder,
  type FolderId,
  type OrgId,
  ok,
  type Result,
  validationError,
} from "arp-domain";
import { loadOwnedFolder, type OwnedGuardMessages } from "../load-owned";
import type { FolderRepository, IdGenerator } from "../ports";

const PARENT_FOLDER_MESSAGES: OwnedGuardMessages = {
  notFound: "parent folder not found",
  notAllowed: "parent folder is not in your org",
};

/** Max folder nesting (Root = 0); the deepest folder is depth MAX_FOLDER_DEPTH. */
export const MAX_FOLDER_DEPTH = 8;

export interface CreateFolderDeps {
  readonly folders: FolderRepository;
  readonly ids: IdGenerator;
}

export interface CreateFolderActor {
  readonly orgId: OrgId;
}

export interface CreateFolderInput {
  /** Parent folder — required; the org Root is provisioned, not created here. */
  readonly parentId: FolderId;
  readonly name: string;
}

export async function createFolder(
  deps: CreateFolderDeps,
  actor: CreateFolderActor,
  input: CreateFolderInput,
): Promise<Result<Folder, AppError>> {
  const parent = await loadOwnedFolder(deps.folders, actor, input.parentId, PARENT_FOLDER_MESSAGES);
  if (!parent.ok) return parent;

  const depth = await parentDepth(deps.folders, parent.value);
  if (!depth.ok) return depth;
  if (depth.value + 1 > MAX_FOLDER_DEPTH) {
    return err(
      validationError(`folders can nest at most ${MAX_FOLDER_DEPTH} levels deep`, "parentId"),
    );
  }

  const built = buildFolder({
    id: deps.ids.folderId(),
    orgId: actor.orgId,
    parentId: input.parentId,
    name: input.name,
  });
  if (!built.ok) return built;

  const saved = await deps.folders.save(built.value);
  if (!saved.ok) return saved;
  return ok(built.value);
}

/** Depth of `folder` relative to its Root (Root = 0), by walking parent_id up. */
async function parentDepth(
  folders: FolderRepository,
  folder: Folder,
): Promise<Result<number, AppError>> {
  let depth = 0;
  let current = folder;
  // Bounded walk: MAX_FOLDER_DEPTH+2 steps caps a (malformed) cyclic chain.
  for (let i = 0; i <= MAX_FOLDER_DEPTH + 1 && current.parentId !== null; i += 1) {
    const next = await folders.findById(current.parentId);
    if (!next.ok) return next;
    if (!next.value) break; // broken chain — stop counting
    current = next.value;
    depth += 1;
  }
  return ok(depth);
}

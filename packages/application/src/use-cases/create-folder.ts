// createFolder — create a Folder in the acting org, optionally under a parent
// (ADR-0036, Reports & Folders). Pure orchestration over FolderRepository +
// IdGenerator (ADR-0024): validate the parent belongs to the actor's org (the
// authorization boundary — no nesting under another org's folder), mint the id,
// build + validate via the domain factory, persist. Sibling-slug uniqueness is
// DB-enforced; a clash surfaces as a ValidationError.
import {
  type AppError,
  createFolder as buildFolder,
  err,
  type Folder,
  type FolderId,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type Result,
} from "arp-domain";
import type { FolderRepository, IdGenerator } from "../ports";

export interface CreateFolderDeps {
  readonly folders: FolderRepository;
  readonly ids: IdGenerator;
}

export interface CreateFolderActor {
  readonly orgId: OrgId;
}

export interface CreateFolderInput {
  /** Parent folder, or null for a top-level folder. */
  readonly parentId: FolderId | null;
  readonly name: string;
}

export async function createFolder(
  deps: CreateFolderDeps,
  actor: CreateFolderActor,
  input: CreateFolderInput,
): Promise<Result<Folder, AppError>> {
  if (input.parentId) {
    const parent = await deps.folders.findById(input.parentId);
    if (!parent.ok) return parent;
    if (!parent.value) return err(notFound("parent folder not found"));
    if (parent.value.orgId !== actor.orgId) {
      return err(notAllowed("parent folder is not in your org"));
    }
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

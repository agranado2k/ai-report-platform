// createFolder — create a Folder under a parent in the acting org (ADR-0036,
// Reports & Folders). Pure orchestration over FolderRepository + IdGenerator
// (ADR-0024). Invariants enforced here:
//   - the parent must exist, not be soft-deleted, belong to the actor's org
//     (issue #132), be VISIBLE to the actor, and be writable by them
//     (ADR-0076: owner, or anyone for legacy/org-visible parents — an
//     invisible private parent isn't even resolvable, reading as NotFound);
//   - a parent is REQUIRED — the single org Root (parent_id NULL) is created at
//     provisioning, never via this use case, so we can't mint a second Root;
//   - max nesting depth 8 (docs/db-design.md, ADR-0037), Root = depth 0;
//   - the new folder is OWNED by its creator; its visibility is inherited
//     (ADR-0076): private under the Root, else the parent's visibility.
// Sibling-slug uniqueness is DB-enforced; a clash surfaces as a ValidationError.
// Load+authz stays OUTSIDE the tx; persists via save + a `folder.created`
// audit_log row (ADR-0070), committed together (ADR-0037 §5).
import {
  type AppError,
  createFolder as buildFolder,
  err,
  type Folder,
  type FolderId,
  inheritedVisibility,
  ok,
  type Result,
  validationError,
} from "arp-domain";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reviveFolderReplay,
} from "../idempotent-write";
import {
  type FolderAccessDeps,
  type FolderGuardMessages,
  loadWritableFolder,
  type TenancyActor,
} from "../load-owned";
import type { AuditLogger, FolderRepository, IdGenerator, UnitOfWork } from "../ports";

const ROUTE = "POST /api/v1/folders";

const PARENT_FOLDER_MESSAGES: FolderGuardMessages = {
  notFound: "parent folder not found",
  notInOrg: "parent folder is not in your org",
  notWritable: "you do not have write access to the parent folder",
};

/** Max folder nesting (Root = 0); the deepest folder is depth MAX_FOLDER_DEPTH. */
export const MAX_FOLDER_DEPTH = 8;

export interface CreateFolderDeps extends IdempotentWriteDeps, FolderAccessDeps {
  readonly folders: FolderRepository;
  readonly ids: IdGenerator;
  /** Audit log (ADR-0070) — one `folder.created` row per create. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

/** `userId` now gates authorization too (ADR-0076): the parent must be
 *  visible + writable for THIS user, and the new folder is owned by them. */
export type CreateFolderActor = TenancyActor;

export interface CreateFolderInput {
  /** Parent folder — required; the org Root is provisioned, not created here. */
  readonly parentId: FolderId;
  readonly name: string;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function createFolder(
  deps: CreateFolderDeps,
  actor: CreateFolderActor,
  input: CreateFolderInput,
): Promise<Result<Folder, AppError>> {
  const parent = await loadWritableFolder(
    deps.folders,
    actor,
    input.parentId,
    deps,
    PARENT_FOLDER_MESSAGES,
  );
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
    // ADR-0076: the creator owns the new folder; visibility is inherited —
    // private under the Root (private-by-default), else the parent's.
    ownerId: actor.userId,
    visibility: inheritedVisibility(parent.value),
    name: input.name,
  });
  if (!built.ok) return built;

  // Idempotency (ADR-0039), claimed after validation so a rejected request
  // never poisons a key: a retried create replays the ORIGINAL folder
  // resource instead of minting a duplicate / sibling-slug clash.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    key: input.idempotencyKey,
    fingerprint: [input.parentId, input.name],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveFolderReplay(idem.value.record);
  const idemRef = idem.value.ref;

  return deps.uow.run(async () => {
    const saved = await deps.folders.save(built.value);
    if (!saved.ok) return saved;
    const audited = await deps.audit.record([
      {
        action: "folder.created",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "folder",
        targetId: built.value.id,
        meta: { parentId: input.parentId },
      },
    ]);
    if (!audited.ok) return audited;
    const done = await deps.idempotency.complete(idemRef, {
      responseStatus: 201,
      responseBody: built.value,
    });
    if (!done.ok) return done;
    return ok(built.value);
  });
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

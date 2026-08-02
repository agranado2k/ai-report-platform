// listFolders — the acting user's VISIBLE slice of the org's Folders
// (ADR-0076, mirroring ADR-0075's report listing), in two shapes behind one
// use case (ADR-0036, Reports & Folders): with no pagination params, the
// WHOLE visible folder tree (the dashboard sidebar needs every visible folder
// to build it — grafting orphans under Root is the caller's rendering
// concern); with limit/startingAfter/endingBefore given, the SAME
// cursor-paginated search searchReports uses (the JSON API's GET
// /api/v1/folders, ADR-0053). The actor's mirrored email is resolved once
// (the `hasWriteGrant` seam, ADR-0060 §2) so email-only folder shares match
// in the repository predicate. Pure orchestration over the FolderRepository
// (ADR-0024); org scope is the tenancy boundary.
import type { AppError, FolderId, OrgId, Result, UserId } from "arp-domain";
import { ok } from "arp-domain";
import type { FolderPage, FolderRepository, FolderViewer, IdentityStore } from "../ports";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ListFoldersDeps {
  readonly folders: FolderRepository;
  /** Resolves the actor's mirrored email for the folder-share email match
   *  (ADR-0060 §2 / ADR-0076) — exactly the seam `hasWriteGrant` uses. */
  readonly identities: Pick<IdentityStore, "findEmailByUserId">;
}
export interface ListFoldersActor {
  readonly orgId: OrgId;
  readonly userId: UserId;
}
export interface ListFoldersInput {
  readonly limit?: number;
  readonly startingAfter?: FolderId;
  readonly endingBefore?: FolderId;
}

export async function listFolders(
  deps: ListFoldersDeps,
  actor: ListFoldersActor,
  input: ListFoldersInput = {},
): Promise<Result<FolderPage, AppError>> {
  const email = await deps.identities.findEmailByUserId(actor.userId);
  if (!email.ok) return email;
  const viewer: FolderViewer = { userId: actor.userId, email: email.value ?? undefined };

  const noPaginationRequested =
    input.limit === undefined &&
    input.startingAfter === undefined &&
    input.endingBefore === undefined;

  if (noPaginationRequested) {
    const all = await deps.folders.listByOrg(actor.orgId, viewer);
    if (!all.ok) return all;
    return ok({ items: all.value, hasMore: false });
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  return deps.folders.searchByOrg(actor.orgId, viewer, {
    limit,
    startingAfter: input.startingAfter,
    endingBefore: input.endingBefore,
  });
}

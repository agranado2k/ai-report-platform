// listFolders — the acting org's Folders, in two shapes behind one use case
// (ADR-0036, Reports & Folders): with no pagination params, the WHOLE org
// folder tree (the dashboard sidebar needs every folder to build it, not a
// paginated slice); with limit/startingAfter/endingBefore given, the SAME
// cursor-paginated search searchReports uses (the JSON API's GET
// /api/v1/folders, ADR-0053). Pure orchestration over the FolderRepository
// (ADR-0024); org scope is the authorization boundary.
import type { AppError, FolderId, OrgId, Result } from "arp-domain";
import { ok } from "arp-domain";
import type { FolderPage, FolderRepository } from "../ports";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ListFoldersDeps {
  readonly folders: FolderRepository;
}
export interface ListFoldersActor {
  readonly orgId: OrgId;
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
  const noPaginationRequested =
    input.limit === undefined &&
    input.startingAfter === undefined &&
    input.endingBefore === undefined;

  if (noPaginationRequested) {
    const all = await deps.folders.listByOrg(actor.orgId);
    if (!all.ok) return all;
    return ok({ items: all.value, hasMore: false });
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  return deps.folders.searchByOrg(actor.orgId, {
    limit,
    startingAfter: input.startingAfter,
    endingBefore: input.endingBefore,
  });
}

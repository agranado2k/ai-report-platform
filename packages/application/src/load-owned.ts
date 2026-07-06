// loadOwnedReport / loadOwnedFolder — the tenancy guard shared by every
// single-resource use case (ADR-0038 for reports, ADR-0036 for folders): load
// by slug/id → a soft-deleted row reads as absent → the row must belong to the
// actor's org. One resolver instead of the same four-line block copy-pasted
// across get/rename/delete/move/setAcl-report and rename/delete-folder.
//
// Repo errors pass through unchanged (no message override applies to them).
// Callers may override the NotFound/NotAllowed message text for one call site
// — e.g. moveReport's target-folder check reads "target folder …", not the
// default "folder …" — the existence/soft-delete/org-ownership behavior is
// otherwise identical everywhere this is used.
import {
  type AppError,
  err,
  type Folder,
  type FolderId,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type Report,
  type Result,
  type Slug,
} from "arp-domain";
import type { FolderRepository, ReportRepository } from "./ports";

export interface TenancyActor {
  readonly orgId: OrgId;
}

/** Override the default NotFound / NotAllowed message text for one call site. */
export interface OwnedGuardMessages {
  readonly notFound: string;
  readonly notAllowed: string;
}

const REPORT_MESSAGES: OwnedGuardMessages = {
  notFound: "report not found",
  notAllowed: "report is not in your org",
};

const FOLDER_MESSAGES: OwnedGuardMessages = {
  notFound: "folder not found",
  notAllowed: "folder is not in your org",
};

/** Load a Report by slug: must exist, not be soft-deleted, and belong to the
 *  actor's org — else NotFound / NotAllowed (ADR-0038). */
export async function loadOwnedReport(
  reports: ReportRepository,
  actor: TenancyActor,
  slug: Slug,
  messages: OwnedGuardMessages = REPORT_MESSAGES,
): Promise<Result<Report, AppError>> {
  const found = await reports.findBySlug(slug);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound(messages.notFound));
  if (found.value.orgId !== actor.orgId) return err(notAllowed(messages.notAllowed));
  return ok(found.value);
}

/** Load a Folder by id: must exist, not be soft-deleted, and belong to the
 *  actor's org — else NotFound / NotAllowed (ADR-0036). */
export async function loadOwnedFolder(
  folders: FolderRepository,
  actor: TenancyActor,
  folderId: FolderId,
  messages: OwnedGuardMessages = FOLDER_MESSAGES,
): Promise<Result<Folder, AppError>> {
  const found = await folders.findById(folderId);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound(messages.notFound));
  if (found.value.orgId !== actor.orgId) return err(notAllowed(messages.notAllowed));
  return ok(found.value);
}

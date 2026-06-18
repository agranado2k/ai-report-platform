// moveReport — move a Report into a different Folder within the acting org
// (ADR-0036, Reports & Folders). Pure orchestration over the Report + Folder
// repositories (ADR-0024). Authorization boundary: BOTH the report and the
// target folder must belong to the actor's org. Persists via the report's save
// (which now upserts folder_id).
import {
  type AppError,
  err,
  type FolderId,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  placeInFolder,
  type Result,
  type Slug,
} from "arp-domain";
import type { FolderRepository, ReportRepository } from "../ports";

export interface MoveReportDeps {
  readonly reports: ReportRepository;
  readonly folders: FolderRepository;
}

export interface MoveReportActor {
  readonly orgId: OrgId;
}

export interface MoveReportInput {
  readonly slug: Slug;
  readonly toFolderId: FolderId;
}

export async function moveReport(
  deps: MoveReportDeps,
  actor: MoveReportActor,
  input: MoveReportInput,
): Promise<Result<void, AppError>> {
  const found = await deps.reports.findBySlug(input.slug);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound("report not found"));
  if (found.value.orgId !== actor.orgId) return err(notAllowed("report is not in your org"));

  const target = await deps.folders.findById(input.toFolderId);
  if (!target.ok) return target;
  if (!target.value || target.value.deletedAt !== null) {
    return err(notFound("target folder not found"));
  }
  if (target.value.orgId !== actor.orgId) {
    return err(notAllowed("target folder is not in your org"));
  }

  return deps.reports.save(placeInFolder(found.value, input.toFolderId));
}

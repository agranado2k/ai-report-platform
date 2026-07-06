// moveReport — move a Report into a different Folder within the acting org
// (ADR-0036, Reports & Folders). Pure orchestration over the Report + Folder
// repositories (ADR-0024). Authorization boundary: BOTH the report and the
// target folder must belong to the actor's org — the shared loadOwnedReport /
// loadOwnedFolder guard for each, the latter with target-folder message text.
// Persists via the report's save (which now upserts folder_id).
import {
  type AppError,
  type FolderId,
  type OrgId,
  ok,
  placeInFolder,
  type Report,
  type Result,
  type Slug,
} from "arp-domain";
import { loadOwnedFolder, loadOwnedReport } from "../load-owned";
import type { FolderRepository, ReportRepository } from "../ports";

const TARGET_FOLDER_MESSAGES = {
  notFound: "target folder not found",
  notAllowed: "target folder is not in your org",
};

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
): Promise<Result<Report, AppError>> {
  const found = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!found.ok) return found;

  const target = await loadOwnedFolder(
    deps.folders,
    actor,
    input.toFolderId,
    TARGET_FOLDER_MESSAGES,
  );
  if (!target.ok) return target;

  const moved = placeInFolder(found.value, input.toFolderId);
  const saved = await deps.reports.save(moved);
  if (!saved.ok) return saved;
  return ok(moved); // the moved report → the resource the API returns (ADR-0053)
}

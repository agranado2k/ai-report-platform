// deleteReport — soft-delete a Report in the acting org (ADR-0038). Pure
// orchestration over the ReportRepository (ADR-0024): load+authz (the shared
// loadOwnedReport guard) → softDelete (sets deleted_at; the viewer then returns
// 410). The slug + blobs are retained for the appeal/purge window (db-design.md).
import type { AppError, OrgId, Result, Slug } from "arp-domain";
import { loadOwnedReport } from "../load-owned";
import type { ReportRepository } from "../ports";

export interface DeleteReportDeps {
  readonly reports: ReportRepository;
}
export interface DeleteReportActor {
  readonly orgId: OrgId;
}
export interface DeleteReportInput {
  readonly slug: Slug;
}

export async function deleteReport(
  deps: DeleteReportDeps,
  actor: DeleteReportActor,
  input: DeleteReportInput,
): Promise<Result<void, AppError>> {
  const found = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!found.ok) return found;

  return deps.reports.softDelete(found.value.id);
}

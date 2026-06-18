// deleteReport — soft-delete a Report in the acting org (ADR-0038). Pure
// orchestration over the ReportRepository (ADR-0024): load by slug → authz →
// softDelete (sets deleted_at; the viewer then returns 410). The slug + blobs
// are retained for the appeal/purge window (db-design.md).
import {
  type AppError,
  err,
  notAllowed,
  notFound,
  type OrgId,
  type Result,
  type Slug,
} from "arp-domain";
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
  const found = await deps.reports.findBySlug(input.slug);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound("report not found"));
  if (found.value.orgId !== actor.orgId) return err(notAllowed("report is not in your org"));

  return deps.reports.softDelete(found.value.id);
}

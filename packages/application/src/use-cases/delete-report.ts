// deleteReport — soft-delete a Report. OWNER-ONLY, permanently (ADR-0059 §2 —
// deliberately NOT on the canWrite seam: a future write grant must never allow
// delete). Pure orchestration over the ReportRepository (ADR-0024): load+authz
// (the shared loadOwnedReport owner guard) → softDelete (sets deleted_at; the
// viewer then returns 410). The slug + blobs are retained for the appeal/purge
// window (db-design.md).
import type { AppError, Result, Slug } from "arp-domain";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type { ReportRepository } from "../ports";

export interface DeleteReportDeps {
  readonly reports: ReportRepository;
}
export type DeleteReportActor = TenancyActor;
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

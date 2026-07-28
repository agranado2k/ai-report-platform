// deleteReport — soft-delete a Report. OWNER-ONLY, permanently (ADR-0059 §2 —
// deliberately NOT on the canWrite seam: a future write grant must never allow
// delete). Pure orchestration over the ReportRepository (ADR-0024): load+authz
// (the shared loadOwnedReport owner guard) → softDelete (sets deleted_at; the
// viewer then returns 410) + an audit_log row (ADR-0070), committed together
// (ADR-0037 §5 commit-last atomicity). The slug + blobs are retained for the
// appeal/purge window (db-design.md).
import type { AppError, Result, Slug } from "arp-domain";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type { AuditLogger, ReportRepository, UnitOfWork } from "../ports";

export interface DeleteReportDeps {
  readonly reports: ReportRepository;
  /** Audit log (ADR-0070) — one `report.deleted` row per soft-delete. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
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

  return deps.uow.run(async () => {
    const deleted = await deps.reports.softDelete(found.value.id);
    if (!deleted.ok) return deleted;
    return deps.audit.record([
      {
        action: "report.deleted",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: found.value.id,
      },
    ]);
  });
}

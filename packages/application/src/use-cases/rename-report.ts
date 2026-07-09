// renameReport — change a Report's display title (ADR-0038). Authorization is
// the `canWrite` seam (ADR-0059/0060: owner OR write-grantee) via the shared
// loadWritableReport guard — it REPLACES the old org check for this
// operation. Pure orchestration over the ReportRepository (ADR-0024):
// load+authz (OUTSIDE the tx) → apply the domain rename transition → persist
// via save + a `report.renamed` audit_log row (ADR-0070), committed together
// (ADR-0037 §5 commit-last atomicity). The slug is permanent and unaffected.
import {
  type AppError,
  renameReport as applyRename,
  ok,
  type Report,
  type Result,
  type Slug,
} from "arp-domain";
import { loadWritableReport, type TenancyActor, type WriteGrantCheckDeps } from "../load-owned";
import type { AuditLogger, ReportRepository, UnitOfWork } from "../ports";

export interface RenameReportDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  /** Audit log (ADR-0070) — one `report.renamed` row per rename. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export type RenameReportActor = TenancyActor;
export interface RenameReportInput {
  readonly slug: Slug;
  readonly title: string;
}

export async function renameReport(
  deps: RenameReportDeps,
  actor: RenameReportActor,
  input: RenameReportInput,
): Promise<Result<Report, AppError>> {
  const found = await loadWritableReport(deps.reports, actor, input.slug, deps);
  if (!found.ok) return found;
  const fromTitle = found.value.title;

  const renamed = applyRename(found.value, input.title);
  if (!renamed.ok) return renamed;

  return deps.uow.run(async () => {
    const saved = await deps.reports.save(renamed.value);
    if (!saved.ok) return saved;
    const audited = await deps.audit.record([
      {
        action: "report.renamed",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: found.value.id,
        meta: { from: fromTitle, to: renamed.value.title },
      },
    ]);
    if (!audited.ok) return audited;
    return ok(renamed.value);
  });
}

// listReports — the dashboard read: an org's reports as lightweight summaries,
// newest first (ADR-0036, Reports & Folders). Pure orchestration over the
// ReportRepository (ADR-0024); the org scope is the authorization boundary — a
// caller only ever sees their own org's reports.
import type { AppError, OrgId, Result } from "arp-domain";
import type { ReportRepository, ReportSummary } from "../ports";

export interface ListReportsDeps {
  readonly reports: ReportRepository;
}

/** The acting principal, narrowed to what listing needs: its org scope. */
export interface ListReportsActor {
  readonly orgId: OrgId;
}

export async function listReports(
  deps: ListReportsDeps,
  actor: ListReportsActor,
): Promise<Result<readonly ReportSummary[], AppError>> {
  return deps.reports.listByOrg(actor.orgId);
}

// getReport — read a single Report by slug, scoped to the acting org (ADR-0038;
// reads stay org-visible under ADR-0059 §3). Pure orchestration over the
// ReportRepository (ADR-0024): load by slug → authz (must exist, not be taken
// down, belong to the actor's org) → return it. No mutation, no provisioning.
// The load+authz is the shared loadOrgReport guard (../load-owned.ts); this
// use case is just that guard.
import type { AppError, OrgId, Report, Result, Slug } from "arp-domain";
import { loadOrgReport } from "../load-owned";
import type { ReportRepository } from "../ports";

export interface GetReportDeps {
  readonly reports: ReportRepository;
}
export interface GetReportActor {
  readonly orgId: OrgId;
}
export interface GetReportInput {
  readonly slug: Slug;
}

export async function getReport(
  deps: GetReportDeps,
  actor: GetReportActor,
  input: GetReportInput,
): Promise<Result<Report, AppError>> {
  return loadOrgReport(deps.reports, actor, input.slug);
}

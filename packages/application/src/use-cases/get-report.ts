// getReport — read a single Report by slug (ADR-0038; reads stay org-visible
// under ADR-0059 §3), PLUS the cross-org write-grantee metadata carve-out
// (ADR-0060 §4) — a grantee outside the report's org can still confirm what
// they can write. Pure orchestration over the ReportRepository (ADR-0024):
// load by slug → authz (org-visible OR grantee) → return it. No mutation, no
// provisioning. The load+authz is the shared loadReadableReport guard
// (../load-owned.ts); this use case is just that guard.
import type { AppError, Report, Result, Slug } from "arp-domain";
import { loadReadableReport, type TenancyActor, type WriteGrantCheckDeps } from "../load-owned";
import type { ReportRepository } from "../ports";

export interface GetReportDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
}
export type GetReportActor = TenancyActor;
export interface GetReportInput {
  readonly slug: Slug;
}

export async function getReport(
  deps: GetReportDeps,
  actor: GetReportActor,
  input: GetReportInput,
): Promise<Result<Report, AppError>> {
  return loadReadableReport(deps.reports, actor, input.slug, deps);
}

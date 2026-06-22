// getReport — read a single Report by slug, scoped to the acting org (ADR-0038).
// Pure orchestration over the ReportRepository (ADR-0024): load by slug → authz
// (must exist, not be taken down, belong to the actor's org) → return it. No
// mutation, no provisioning. Mirrors renameReport's load+authz, minus the write.
import {
  type AppError,
  err,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type Report,
  type Result,
  type Slug,
} from "arp-domain";
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
  const found = await deps.reports.findBySlug(input.slug);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound("report not found"));
  if (found.value.orgId !== actor.orgId) return err(notAllowed("report is not in your org"));
  return ok(found.value);
}

// getAcl — read a Report's sharing Acl for its OWNER (ADR-0059 §3: the ACL
// sub-resource GET /api/v1/reports/{slug}/acl is owner-only — allowlist emails
// and share config are the owner's business; org members see only list
// metadata). The load+authz is the shared loadOwnedReport owner guard.
//
// NOT to be confused with `getReportAcl` (get-report-acl.ts) — that one is the
// DELIBERATELY UNAUTHENTICATED loader for the public /unlock/{slug} flow and
// must stay ungated (ADR-0059 "More information").
import type { AppError, Report, Result, Slug } from "arp-domain";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type { ReportRepository } from "../ports";

export interface GetAclDeps {
  readonly reports: ReportRepository;
}
export type GetAclActor = TenancyActor;
export interface GetAclInput {
  readonly slug: Slug;
}

export async function getAcl(
  deps: GetAclDeps,
  actor: GetAclActor,
  input: GetAclInput,
): Promise<Result<Report, AppError>> {
  return loadOwnedReport(deps.reports, actor, input.slug);
}

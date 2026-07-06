// getReportAcl — load a Report (and its Acl) by slug for the PUBLIC unlock
// flow (ADR-0056: /unlock/{slug}). Deliberately UNAUTHENTICATED and
// UNSCOPED to any org — unlike getReport, there's no acting org here; the
// whole point of a report's Acl is to gate access for callers who aren't
// (yet) the owning org. Returns null (not NotFound) for a missing or
// soft-deleted report — the route renders its own "not available" notice
// rather than a JSON API error.
import type { AppError, Report, Result, Slug } from "arp-domain";
import { ok } from "arp-domain";
import type { ReportRepository } from "../ports";

export interface GetReportAclDeps {
  readonly reports: ReportRepository;
}
export interface GetReportAclInput {
  readonly slug: Slug;
}

export async function getReportAcl(
  deps: GetReportAclDeps,
  input: GetReportAclInput,
): Promise<Result<Report | null, AppError>> {
  const found = await deps.reports.findBySlug(input.slug);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return ok(null);
  return ok(found.value);
}

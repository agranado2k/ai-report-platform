// listReportVersions — the version-history read surface for one Report
// (ADR-0065). Auth is IDENTICAL to getReport (../load-owned.ts's loadOwnedReport
// guard, org-scoped): must exist, not be soft-deleted, and belong to the
// actor's org. Pure orchestration over the ReportRepository (ADR-0024): resolve
// + authorize the report, then page its versions (newest-created first,
// ADR-0053 cursor pagination — same clamp/shape as searchReports).
import type { AppError, OrgId, Result, Slug, VersionId } from "arp-domain";
import { loadOwnedReport } from "../load-owned";
import type { ReportRepository, VersionPage } from "../ports";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ListReportVersionsDeps {
  readonly reports: ReportRepository;
}
export interface ListReportVersionsActor {
  readonly orgId: OrgId;
}
export interface ListReportVersionsInput {
  readonly slug: Slug;
  readonly limit?: number;
  readonly startingAfter?: VersionId;
  readonly endingBefore?: VersionId;
}

export async function listReportVersions(
  deps: ListReportVersionsDeps,
  actor: ListReportVersionsActor,
  input: ListReportVersionsInput,
): Promise<Result<VersionPage, AppError>> {
  const owned = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!owned.ok) return owned;

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  return deps.reports.listVersions(owned.value.id, {
    limit,
    startingAfter: input.startingAfter,
    endingBefore: input.endingBefore,
  });
}

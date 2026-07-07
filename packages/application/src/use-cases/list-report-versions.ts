// listReportVersions — the version-history read surface for one Report
// (ADR-0065). Auth is IDENTICAL to getReport (../load-owned.ts's loadOrgReport
// guard, org-scoped, ADR-0059 §3): must exist, not be soft-deleted, and belong
// to the actor's org. ADR-0059 §3 / ADR-0065 §1 also call for a write-grantee
// metadata carve-out (a cross-org grantee can read what they can write) — that
// carve-out isn't implemented anywhere yet (ADR-0060 write grants are schema-only,
// no `hasWriteGrant` in code as of PR #146), so getReport doesn't have it either.
// Once it lands on getReport, mirror it here in the same change. Pure
// orchestration over the ReportRepository (ADR-0024): resolve + authorize the
// report, then page its versions (newest-created first, ADR-0053 cursor
// pagination — same clamp/shape as searchReports).
import type { AppError, OrgId, Result, Slug, VersionId } from "arp-domain";
import { loadOrgReport } from "../load-owned";
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
  const org = await loadOrgReport(deps.reports, actor, input.slug);
  if (!org.ok) return org;

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  return deps.reports.listVersions(org.value.id, {
    limit,
    startingAfter: input.startingAfter,
    endingBefore: input.endingBefore,
  });
}

// searchReports — the cursor-paginated, searchable read across an org's reports
// (ADR-0036, Reports & Folders; ADR-0053 cursor pagination). Pure orchestration
// over the ReportRepository (ADR-0024): clamp the limit, pass the keyset cursor
// (startingAfter/endingBefore on the report id) + optional query/folder filter,
// return the page {items, hasMore}. Org scope is the authorization boundary.
import type { AppError, FolderId, OrgId, ReportId, Result } from "arp-domain";
import type { ReportPage, ReportRepository } from "../ports";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface SearchReportsDeps {
  readonly reports: ReportRepository;
}
export interface SearchReportsActor {
  readonly orgId: OrgId;
}
export interface SearchReportsInput {
  readonly query?: string;
  readonly folderId?: FolderId;
  readonly limit?: number;
  readonly startingAfter?: ReportId;
  readonly endingBefore?: ReportId;
}

export async function searchReports(
  deps: SearchReportsDeps,
  actor: SearchReportsActor,
  input: SearchReportsInput,
): Promise<Result<ReportPage, AppError>> {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  return deps.reports.searchByOrg(actor.orgId, {
    query: input.query,
    folderId: input.folderId,
    limit,
    startingAfter: input.startingAfter,
    endingBefore: input.endingBefore,
  });
}

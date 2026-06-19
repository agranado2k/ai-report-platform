// searchReports — the paged, searchable dashboard read across an org's reports
// (ADR-0036, Reports & Folders). Pure orchestration over the ReportRepository
// (ADR-0024): turn a 1-based page + optional query/folder filter into a
// limit/offset query and return the page plus the total (for page navigation).
// Org scope is the authorization boundary — a caller only sees its own org.
import type { AppError, FolderId, OrgId, Result } from "arp-domain";
import type { ReportPage, ReportRepository } from "../ports";

export interface SearchReportsDeps {
  readonly reports: ReportRepository;
}
export interface SearchReportsActor {
  readonly orgId: OrgId;
}
export interface SearchReportsInput {
  readonly query?: string;
  readonly folderId?: FolderId;
  /** 1-based page number; clamped to >= 1. */
  readonly page: number;
  readonly pageSize: number;
}

export interface SearchReportsResult extends ReportPage {
  readonly page: number;
  readonly pageSize: number;
}

export async function searchReports(
  deps: SearchReportsDeps,
  actor: SearchReportsActor,
  input: SearchReportsInput,
): Promise<Result<SearchReportsResult, AppError>> {
  const page = Math.max(1, Math.floor(input.page) || 1);
  const pageSize = Math.max(1, Math.floor(input.pageSize) || 1);
  const result = await deps.reports.searchByOrg(actor.orgId, {
    query: input.query,
    folderId: input.folderId,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  if (!result.ok) return result;
  return { ok: true, value: { ...result.value, page, pageSize } };
}

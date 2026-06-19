// HTTP response mappers for the read API (ADR-0040): GET /api/v1/reports and
// GET /api/v1/folders. Pure — turn the use-case Result into a 200 JSON list or
// an application/problem+json error. Field names are snake_case on the wire
// (matching the upload response); the internal org id is never serialized.

import type { ReportSummary } from "arp-application";
import type { AppError, Folder, Result } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";

/** The wire shape of a ReportSummary (snake_case; internal org id never serialized). */
function summaryBody(r: ReportSummary) {
  return { slug: r.slug, title: r.title, is_published: r.isPublished, folder_id: r.folderId };
}

/** GET /api/v1/reports — the org's reports as lightweight summaries. */
export function listReportsToHttp(
  result: Result<readonly ReportSummary[], AppError>,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: { reports: result.value.map(summaryBody) },
  };
}

/** A page of report summaries (searchReports use case) → the paged GET /api/v1/reports body. */
export interface ReportPageView {
  readonly items: readonly ReportSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** GET /api/v1/reports (paged + searchable) — 200 with the page + paging metadata. */
export function searchReportsToHttp(result: Result<ReportPageView, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const { items, total, page, pageSize } = result.value;
  return {
    status: 200,
    contentType: "application/json",
    body: { reports: items.map(summaryBody), page, page_size: pageSize, total },
  };
}

/** GET /api/v1/folders — the org's folder tree as a flat list (parent_id links it). */
export function listFoldersToHttp(result: Result<readonly Folder[], AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: {
      // org_id and deletedAt are internal — the wire shape is id + name + slug
      // + parent_id (the tree link). The repository already excludes soft-deleted.
      folders: result.value.map((f) => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        parent_id: f.parentId,
      })),
    },
  };
}

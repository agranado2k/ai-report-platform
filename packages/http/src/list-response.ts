// HTTP response mappers for the read API (ADR-0040, ADR-0053): GET /api/v1/reports
// and GET /api/v1/folders. Pure — turn the use-case Result into a 200 Stripe-style
// list envelope (`{ object: "list", data: [...], has_more }`) or an
// application/problem+json error. Field names snake_case; internal org id never sent.
import type { FolderPage, ReportPage, VersionPage } from "arp-application";
import type { AppError, Result } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";
import { folderBody, listBody, reportBody, versionBody, type WireContext } from "./resource";

/** GET /api/v1/reports (cursor-paginated + searchable) — 200 list envelope. */
export function searchReportsToHttp(
  result: Result<ReportPage, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const { items, hasMore } = result.value;
  return {
    status: 200,
    contentType: "application/json",
    body: listBody(
      items.map((r) => reportBody(r, ctx)),
      hasMore,
    ),
  };
}

/** GET /api/v1/folders (cursor-paginated) — 200 list envelope; parent_id links the tree. */
export function listFoldersToHttp(
  result: Result<FolderPage, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const { items, hasMore } = result.value;
  return {
    status: 200,
    contentType: "application/json",
    body: listBody(
      items.map((f) => folderBody(f, ctx)),
      hasMore,
    ),
  };
}

/** GET /api/v1/reports/{slug}/versions (cursor-paginated) — 200 list envelope
 *  (ADR-0065), newest-created first. */
export function listReportVersionsToHttp(
  result: Result<VersionPage, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const { items, hasMore } = result.value;
  return {
    status: 200,
    contentType: "application/json",
    body: listBody(
      items.map((v) => versionBody(v, ctx)),
      hasMore,
    ),
  };
}

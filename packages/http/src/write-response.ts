// HTTP response mappers for the write API (ADR-0040): move a report between
// folders and create a folder. Pure — turn the use-case Result into a success
// JSON body or an application/problem+json error. snake_case on the wire; the
// internal org id is never serialized.
import type { AppError, Folder, FolderId, Report, Result, Slug } from "arp-domain";
import { folderIdToWire, reportIdToWire } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";

/** POST /api/v1/reports/{slug}/move — 200 echoing the report's new placement. */
export function moveReportToHttp(
  result: Result<void, AppError>,
  placement: { readonly slug: Slug; readonly folderId: FolderId },
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: { slug: placement.slug, folder_id: folderIdToWire(placement.folderId) },
  };
}

/** The wire shape of a Report (summary; no org id) — shared by rename + get. Both
 *  the `report_…` id and the capability `slug` are returned (ADR-0052). */
function reportSummaryBody(r: Report) {
  return {
    id: reportIdToWire(r.id),
    slug: r.slug,
    title: r.title,
    is_published: r.liveVersionId !== null,
    folder_id: folderIdToWire(r.folderId),
  };
}

/** PATCH /api/v1/reports/{slug} — 200 with the renamed report (summary shape). */
export function renameReportToHttp(result: Result<Report, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: reportSummaryBody(result.value) };
}

/** GET /api/v1/reports/{slug} — 200 with the report (summary shape), or a problem. */
export function getReportToHttp(result: Result<Report, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: reportSummaryBody(result.value) };
}

/** DELETE /api/v1/reports/{slug} — 204 No Content on success. */
export function deleteReportToHttp(result: Result<void, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 204, contentType: "application/json", body: undefined };
}

/** The wire shape of a Folder (no org id) — External Ids prefixed (ADR-0052). */
function folderBody(f: Folder) {
  return {
    id: folderIdToWire(f.id),
    name: f.name,
    slug: f.slug,
    parent_id: f.parentId ? folderIdToWire(f.parentId) : null,
  };
}

/** POST /api/v1/folders — 201 with the created folder. */
export function createFolderToHttp(result: Result<Folder, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 201, contentType: "application/json", body: folderBody(result.value) };
}

/** PATCH /api/v1/folders/{id} — 200 with the renamed folder. */
export function renameFolderToHttp(result: Result<Folder, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: folderBody(result.value) };
}

/** DELETE /api/v1/folders/{id} — 204 No Content on success. */
export function deleteFolderToHttp(result: Result<void, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 204, contentType: "application/json", body: undefined };
}

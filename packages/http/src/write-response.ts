// HTTP response mappers for the write API (ADR-0040): move a report between
// folders and create a folder. Pure — turn the use-case Result into a success
// JSON body or an application/problem+json error. snake_case on the wire; the
// internal org id is never serialized.
import type { AppError, Folder, FolderId, Report, Result, Slug } from "arp-domain";
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
    body: { slug: placement.slug, folder_id: placement.folderId },
  };
}

/** PATCH /api/v1/reports/{slug} — 200 with the renamed report (summary shape). */
export function renameReportToHttp(result: Result<Report, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const r = result.value;
  return {
    status: 200,
    contentType: "application/json",
    body: {
      slug: r.slug,
      title: r.title,
      is_published: r.liveVersionId !== null,
      folder_id: r.folderId,
    },
  };
}

/** DELETE /api/v1/reports/{slug} — 204 No Content on success. */
export function deleteReportToHttp(result: Result<void, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 204, contentType: "application/json", body: undefined };
}

/** The wire shape of a Folder (no org id). */
function folderBody(f: Folder) {
  return { id: f.id, name: f.name, slug: f.slug, parent_id: f.parentId };
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

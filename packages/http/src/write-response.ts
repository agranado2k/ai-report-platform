// HTTP response mappers for the write API (ADR-0040): move a report between
// folders and create a folder. Pure — turn the use-case Result into a success
// JSON body or an application/problem+json error. snake_case on the wire; the
// internal org id is never serialized.
import type { AppError, Folder, FolderId, Result, Slug } from "arp-domain";
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

/** POST /api/v1/folders — 201 with the created folder. */
export function createFolderToHttp(result: Result<Folder, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const f = result.value;
  return {
    status: 201,
    contentType: "application/json",
    body: { id: f.id, name: f.name, slug: f.slug, parent_id: f.parentId },
  };
}

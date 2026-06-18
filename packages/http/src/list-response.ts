// HTTP response mappers for the read API (ADR-0040): GET /api/v1/reports and
// GET /api/v1/folders. Pure — turn the use-case Result into a 200 JSON list or
// an application/problem+json error. Field names are snake_case on the wire
// (matching the upload response); the internal org id is never serialized.

import type { ReportSummary } from "arp-application";
import type { AppError, Folder, Result } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";

/** GET /api/v1/reports — the org's reports as lightweight summaries. */
export function listReportsToHttp(
  result: Result<readonly ReportSummary[], AppError>,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: {
      reports: result.value.map((r) => ({
        slug: r.slug,
        title: r.title,
        is_published: r.isPublished,
        folder_id: r.folderId,
      })),
    },
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

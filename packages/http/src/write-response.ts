// HTTP response mappers for the write API (ADR-0040, ADR-0053). Pure — turn the
// use-case Result into the resource body (Stripe-style `object` + `mode` +
// prefixed id) or an application/problem+json error. snake_case on the wire; the
// internal org id is never serialized.
import type { Acl, AppError, Folder, Report, Result } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";
import { folderBody, reportBody, type WireContext } from "./resource";

/** The `Acl` on the wire (ADR-0056). Surfaces the mode + (for allowlist) the
 *  allowed emails + owner access TTL; the argon2id password hash is NEVER serialized. */
function aclToWire(acl: Acl) {
  return acl.mode === "allowlist"
    ? {
        mode: "allowlist",
        allowed_emails: acl.allowedEmails,
        access_ttl_seconds: acl.accessTtlSeconds,
      }
    : { mode: acl.mode };
}

/** A Report aggregate → the `report` resource body. Single-report responses carry
 *  the `acl` block (loaded with the aggregate); list summaries do not (ADR-0056). */
function reportResource(r: Report, ctx: WireContext) {
  return {
    ...reportBody(
      {
        id: r.id,
        slug: r.slug,
        title: r.title,
        isPublished: r.liveVersionId !== null,
        folderId: r.folderId,
      },
      ctx,
    ),
    acl: aclToWire(r.acl),
  };
}

/** POST /api/v1/reports/{slug}/move — 200 with the moved report resource. */
export function moveReportToHttp(result: Result<Report, AppError>, ctx: WireContext): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: reportResource(result.value, ctx) };
}

/** PATCH /api/v1/reports/{slug} — 200 with the renamed report resource. */
export function renameReportToHttp(
  result: Result<Report, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: reportResource(result.value, ctx) };
}

/** GET /api/v1/reports/{slug} — 200 with the report resource, or a problem. */
export function getReportToHttp(result: Result<Report, AppError>, ctx: WireContext): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: reportResource(result.value, ctx) };
}

/** POST /api/v1/reports/{slug}/acl — 200 with the report resource + its new acl. */
export function setAclToHttp(result: Result<Report, AppError>, ctx: WireContext): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: reportResource(result.value, ctx) };
}

/** DELETE /api/v1/reports/{slug} — 204 No Content on success. */
export function deleteReportToHttp(result: Result<void, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 204, contentType: "application/json", body: undefined };
}

/** POST /api/v1/folders — 201 with the created folder resource. */
export function createFolderToHttp(
  result: Result<Folder, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 201, contentType: "application/json", body: folderBody(result.value, ctx) };
}

/** PATCH /api/v1/folders/{id} — 200 with the renamed folder resource. */
export function renameFolderToHttp(
  result: Result<Folder, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: folderBody(result.value, ctx) };
}

/** DELETE /api/v1/folders/{id} — 204 No Content on success. */
export function deleteFolderToHttp(result: Result<void, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 204, contentType: "application/json", body: undefined };
}

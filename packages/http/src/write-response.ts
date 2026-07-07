// HTTP response mappers for the write API (ADR-0040, ADR-0053). Pure — turn the
// use-case Result into the resource body (Stripe-style `object` + `mode` +
// prefixed id) or an application/problem+json error. snake_case on the wire; the
// internal org id is never serialized.
import type { WriteGrant } from "arp-application";
import type { Acl, AppError, Folder, Report, Result, UserId } from "arp-domain";
import { userIdToWire } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";
import { folderBody, listBody, reportBody, type WireContext } from "./resource";

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

/** The acting user, for owner-conditional serialization (ADR-0059 §3). */
export interface ReportViewer {
  readonly userId: UserId;
}

/** A Report aggregate → the `report` resource body. Single-report responses carry
 *  the `owner` (a `user_…` External Id, ADR-0059 §6 — so the dashboard can
 *  distinguish "yours" from "org") and, ONLY when the viewer IS the owner, the
 *  `acl` block — share config (incl. allowlist emails) is the owner's business
 *  (ADR-0059 §3), so org members (and future ADR-0060 write-grantees) never
 *  receive it. No viewer ⇒ fail closed (no acl). List summaries carry neither
 *  (ADR-0056). */
function reportResource(r: Report, ctx: WireContext, viewer?: ReportViewer) {
  const base = {
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
    owner: userIdToWire(r.ownerId),
  };
  return viewer !== undefined && viewer.userId === r.ownerId
    ? { ...base, acl: aclToWire(r.acl) }
    : base;
}

/** POST /api/v1/reports/{slug}/move — 200 with the moved report resource. */
export function moveReportToHttp(
  result: Result<Report, AppError>,
  ctx: WireContext,
  viewer?: ReportViewer,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: reportResource(result.value, ctx, viewer),
  };
}

/** PATCH /api/v1/reports/{slug} — 200 with the renamed report resource. */
export function renameReportToHttp(
  result: Result<Report, AppError>,
  ctx: WireContext,
  viewer?: ReportViewer,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: reportResource(result.value, ctx, viewer),
  };
}

/** GET /api/v1/reports/{slug} — 200 with the report resource, or a problem. */
export function getReportToHttp(
  result: Result<Report, AppError>,
  ctx: WireContext,
  viewer?: ReportViewer,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: reportResource(result.value, ctx, viewer),
  };
}

/** POST /api/v1/reports/{slug}/acl — 200 with the report resource + its new acl
 *  (the caller is the owner by construction — setAcl is owner-gated). */
export function setAclToHttp(
  result: Result<Report, AppError>,
  ctx: WireContext,
  viewer?: ReportViewer,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: reportResource(result.value, ctx, viewer),
  };
}

/** The `Acl` as a standalone `object: "acl"` resource (ADR-0053/0056) — the focused
 *  read shape for GET /acl, distinct from the full report resource POST returns. */
function aclResource(acl: Acl) {
  return { object: "acl", ...aclToWire(acl) };
}

/** GET /api/v1/reports/{slug}/acl — 200 with just the acl resource, or a problem.
 *  No `WireContext` needed: the acl carries no prefixed ids. */
export function getAclToHttp(result: Result<Report, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: aclResource(result.value.acl) };
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

/** A `WriteGrant` → the `write_grant` resource body (ADR-0060). No surrogate
 *  id — wire-addressed by `(slug, email)`, so only the fields on the wire; the
 *  granting owner is a `user_…` External Id like `Report.owner`. */
function writeGrantBody(g: WriteGrant) {
  return {
    object: "write_grant" as const,
    email: g.granteeEmail,
    granted_by: userIdToWire(g.grantedBy),
    granted_at: new Date(g.grantedAt).toISOString(),
  };
}

/** POST /api/v1/reports/{slug}/write-grants — 201 with the new/refreshed grant. */
export function grantWriteToHttp(result: Result<WriteGrant, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 201, contentType: "application/json", body: writeGrantBody(result.value) };
}

/** DELETE /api/v1/reports/{slug}/write-grants/{email} — 204 No Content on success
 *  (idempotent — revoking a non-existent grant still succeeds). */
export function revokeWriteToHttp(result: Result<void, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 204, contentType: "application/json", body: undefined };
}

/** GET /api/v1/reports/{slug}/write-grants — 200 list envelope (owner-only). */
export function listWriteGrantsToHttp(
  result: Result<readonly WriteGrant[], AppError>,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: listBody(result.value.map(writeGrantBody), false),
  };
}

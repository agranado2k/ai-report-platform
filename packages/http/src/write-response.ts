// HTTP response mappers for the write API (ADR-0040, ADR-0053). Pure — turn the
// use-case Result into the resource body (Stripe-style `object` + `mode` +
// prefixed id) or an application/problem+json error. snake_case on the wire; the
// internal org id is never serialized.
import {
  type FolderShare,
  type ReportSharingResult,
  type ReportSharingView,
  type SharingApplyOutcome,
  sharingApplyIsPartial,
  type WriteGrant,
} from "arp-application";
import type { Acl, AppError, Comment, Folder, Report, Result, UserId } from "arp-domain";
import { userIdToWire } from "arp-domain";
import { errorToHttp, type HttpResponse } from "./problem";
import {
  commentBody,
  folderBody,
  listBody,
  reportBody,
  type WireAuthor,
  type WireContext,
} from "./resource";
import type {
  AclShareWire,
  AclSharingWire,
  AclWire,
  FolderShareWire,
  ReportDetailWire,
  ReportSharingWire,
  SharingApplyEntryWire,
  SharingApplyWire,
  WriteGrantWire,
} from "./wire";

/** The `Acl` on the wire (ADR-0056). Surfaces the mode + (for allowlist) the
 *  allowed emails + owner access TTL; the argon2id password hash is NEVER serialized. */
function aclToWire(acl: Acl): AclShareWire {
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
function reportResource(r: Report, ctx: WireContext, viewer?: ReportViewer): ReportDetailWire {
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

/** GET /api/v1/reports/{slug} — 200 with the report resource PLUS its composed
 *  ADR-0078 `sharing` state, or a problem.
 *
 *  `sharing` rides alongside `acl` for the same reason it does on the write
 *  response, and is present for EVERY reader, not only the owner: it is
 *  strictly coarser than the `acl` block ADR-0059 §3 withholds (it collapses
 *  every advanced mode to `null`), and it is the same claim the dashboard badge
 *  already makes to every member for every row they can see. Withholding it
 *  would leave the read surfaces unable to distinguish `org_view` from
 *  `org_edit` — the gap that made an MCP agent infer the wrong one. */
export function getReportToHttp(
  result: Result<ReportSharingView, AppError>,
  ctx: WireContext,
  viewer?: ReportViewer,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const body: ReportSharingWire = {
    ...reportResource(result.value.report, ctx, viewer),
    sharing: result.value.sharing,
  };
  return { status: 200, contentType: "application/json", body };
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
function aclResource(acl: Acl): AclWire {
  return { object: "acl", ...aclToWire(acl) };
}

/** GET /api/v1/reports/{slug}/acl — 200 with the acl resource PLUS its composed
 *  ADR-0078 `sharing` state, or a problem. No `WireContext` needed: neither
 *  carries a prefixed id.
 *
 *  This route is owner-only (ADR-0059 §3), so the owner asking "how is this
 *  shared?" is exactly the caller who must not have to infer `org_edit` from an
 *  `Acl` that cannot express it. */
export function getAclToHttp(result: Result<ReportSharingView, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const body: AclSharingWire = {
    ...aclResource(result.value.report.acl),
    sharing: result.value.sharing,
  };
  return { status: 200, contentType: "application/json", body };
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

/** POST /api/v1/folders/{id}/visibility — 200 with the updated folder resource
 *  (ADR-0076; a legacy folder comes back ADOPTED — `owner` now set). */
export function setFolderVisibilityToHttp(
  result: Result<Folder, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 200, contentType: "application/json", body: folderBody(result.value, ctx) };
}

/** POST /api/v1/reports/{slug}/sharing — 200 with the report resource plus its
 *  new three-state `sharing` (ADR-0078 §3).
 *
 *  `sharing` rides ALONGSIDE `acl` rather than replacing it: `acl` is the read
 *  authorization the viewer consumes, `sharing` is the composed answer that
 *  also accounts for the Org write grant. A client shown only one of the two
 *  would be able to render a report the whole org can edit as "private".
 *
 *  The caller is the owner by construction (setReportSharing is owner-gated),
 *  so the `acl` block is always serialized here. */
export function setReportSharingToHttp(
  result: Result<ReportSharingResult, AppError>,
  ctx: WireContext,
  viewer?: ReportViewer,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const body: ReportSharingWire = {
    ...reportResource(result.value.report, ctx, viewer),
    sharing: result.value.sharing,
  };
  return { status: 200, contentType: "application/json", body };
}

const sharingEntry = (e: {
  readonly slug: string;
  readonly title: string;
  readonly reason?: string;
}): SharingApplyEntryWire => (e.reason === undefined ? { slug: e.slug, title: e.title } : e);

/** POST /api/v1/folders/{id}/reports/sharing — 200 with the honest partial
 *  result (ADR-0078 §5).
 *
 *  Always 200, even when nothing changed: every entry in the folder was
 *  examined and answered for, which is a successful bulk apply that happened to
 *  find no candidates — not a client error. What must never happen is a 200
 *  that omits the reports it did not touch, which is why `skipped` and `failed`
 *  are serialized separately and in full. */
export function applyFolderSharingToReportsToHttp(
  result: Result<SharingApplyOutcome, AppError>,
  ctx: WireContext,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const o = result.value;
  const body: SharingApplyWire = {
    object: "sharing_apply",
    sharing: o.sharing,
    total: o.total,
    changed: o.changed.map(sharingEntry),
    skipped: o.skipped.map(sharingEntry),
    failed: o.failed.map(sharingEntry),
    // The SERVER's conclusion, not a fact for the client to re-derive.
    partial: sharingApplyIsPartial(o),
    mode: ctx.mode,
  };
  return { status: 200, contentType: "application/json", body };
}

/** A `FolderShare` → the `folder_share` resource body (ADR-0076). Mirrors
 *  `writeGrantBody`: no surrogate id, wire-addressed by `(folder id, email)`. */
function folderShareBody(s: FolderShare): FolderShareWire {
  return {
    object: "folder_share" as const,
    email: s.granteeEmail,
    granted_by: userIdToWire(s.grantedBy),
    granted_at: new Date(s.grantedAt).toISOString(),
  };
}

/** POST /api/v1/folders/{id}/shares — 201 with the new/refreshed share. */
export function shareFolderToHttp(result: Result<FolderShare, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 201, contentType: "application/json", body: folderShareBody(result.value) };
}

/** DELETE /api/v1/folders/{id}/shares/{email} — 204 No Content on success
 *  (idempotent — unsharing a non-existent share still succeeds). */
export function unshareFolderToHttp(result: Result<void, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 204, contentType: "application/json", body: undefined };
}

/** GET /api/v1/folders/{id}/shares — 200 list envelope (owner-or-legacy only). */
export function listFolderSharesToHttp(
  result: Result<readonly FolderShare[], AppError>,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: listBody(result.value.map(folderShareBody), false),
  };
}

/** A `WriteGrant` → the `write_grant` resource body (ADR-0060). No surrogate
 *  id — wire-addressed by `(slug, email)`, so only the fields on the wire; the
 *  granting owner is a `user_…` External Id like `Report.owner`. */
function writeGrantBody(g: WriteGrant): WriteGrantWire {
  return {
    object: "write_grant" as const,
    email: g.granteeEmail,
    granted_by: userIdToWire(g.grantedBy),
    granted_at: new Date(g.grantedAt).toISOString(),
  };
}

/** Where the grantee ENTERS the editor (ADR-0063): the app's canWrite
 *  edit-token mint. Passed by the route (which knows the request's app origin
 *  + slug, mirroring how the upload route passes `viewBaseUrl`). */
export interface GrantEntryOptions {
  /** The app origin, e.g. "https://app.example" (no trailing slash). */
  readonly appOrigin: string;
  readonly slug: string;
}

/** POST /api/v1/reports/{slug}/write-grants — 201 with the new/refreshed grant.
 *  With `entry`, the resource carries `open_url` — the link the owner sends
 *  the grantee (grants are silent, ADR-0060: the response is the only place
 *  the entry URL surfaces). */
export function grantWriteToHttp(
  result: Result<WriteGrant, AppError>,
  entry?: GrantEntryOptions,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  const body = entry
    ? {
        ...writeGrantBody(result.value),
        open_url: `${entry.appOrigin}/reports/${entry.slug}/open`,
      }
    : writeGrantBody(result.value);
  return { status: 201, contentType: "application/json", body };
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

/** POST /api/v1/reports/{slug}/comments — 201 with the created comment resource
 *  (ADR-0064 §7). Also used for a reply — a reply IS a comment resource, just
 *  with `parent_id` set. `authorByUserId` folds the route-layer Author Identity
 *  projection (ADR-0048/ADR-0063) onto the response EXACTLY like
 *  `listCommentsToHttp` — same map shape, same null fallback — so a just-posted
 *  comment renders its author immediately instead of "Unknown user" until the
 *  next list refetch (2026-07-29 dogfood paper cut #3). */
export function addCommentToHttp(
  result: Result<Comment, AppError>,
  ctx: WireContext,
  authorByUserId?: ReadonlyMap<UserId, WireAuthor>,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 201,
    contentType: "application/json",
    body: commentBody(result.value, ctx, authorByUserId?.get(result.value.authorUserId) ?? null),
  };
}

/** PATCH /api/v1/reports/{slug}/comments/{comment_id} — 200 with the resolved
 *  comment resource (ADR-0064 §7, §3 — author-or-owner; idempotent). Covers
 *  BOTH the resolve and edit branches (they share the comment-resource shape),
 *  so both get the same `authorByUserId` Author Identity projection as the
 *  create/list responses above. */
export function resolveCommentToHttp(
  result: Result<Comment, AppError>,
  ctx: WireContext,
  authorByUserId?: ReadonlyMap<UserId, WireAuthor>,
): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return {
    status: 200,
    contentType: "application/json",
    body: commentBody(result.value, ctx, authorByUserId?.get(result.value.authorUserId) ?? null),
  };
}

/** DELETE /api/v1/reports/{slug}/comments/{comment_id} — 204 No Content on
 *  success (ADR-0064 §7, §3 — author-or-owner). */
export function deleteCommentToHttp(result: Result<void, AppError>): HttpResponse {
  if (!result.ok) return errorToHttp(result.error);
  return { status: 204, contentType: "application/json", body: undefined };
}

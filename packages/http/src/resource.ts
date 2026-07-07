// Shared wire-shape builders (ADR-0053). Every resource is a flat snake_case object
// carrying an `object` type discriminator + `mode` + its prefixed External Id
// (ADR-0052); lists use the `{ object: "list", data: [...], has_more }` envelope.
// Errors stay RFC 9457 (ADR-0040). Mapping lives ONLY here, at the http boundary.
import type { ReportVersionSummary } from "arp-application";
import type { Folder, FolderId, ReportId, Slug } from "arp-domain";
import { folderIdToWire, reportIdToWire, userIdToWire, versionIdToWire } from "arp-domain";

/** Which deployment a resource belongs to (ADR-0053): the live product vs preview/dev. */
export type WireMode = "prod" | "dev";

/** Per-request wire context: the deployment `mode` stamped onto every resource.
 *  (Request-Id is a response header, set by the app boundary — not a body field.) */
export interface WireContext {
  readonly mode: WireMode;
}

/** A `report` resource (summary shape) — both the `report_` id and the slug. */
export function reportBody(
  r: {
    readonly id: ReportId;
    readonly slug: Slug;
    readonly title: string;
    readonly isPublished: boolean;
    readonly folderId: FolderId;
  },
  ctx: WireContext,
) {
  return {
    object: "report" as const,
    id: reportIdToWire(r.id),
    slug: r.slug,
    title: r.title,
    is_published: r.isPublished,
    folder_id: folderIdToWire(r.folderId),
    mode: ctx.mode,
  };
}

/** A `folder` resource. */
export function folderBody(f: Folder, ctx: WireContext) {
  return {
    object: "folder" as const,
    id: folderIdToWire(f.id),
    name: f.name,
    slug: f.slug,
    parent_id: f.parentId ? folderIdToWire(f.parentId) : null,
    mode: ctx.mode,
  };
}

/** A `version` resource (ADR-0065) — the ReportVersionSummary projection on the
 *  wire: both the version's `version_` id and the uploader's `user_` id.
 *  `uploaded_at` renders as an ISO-8601 string (no existing timestamp wire field
 *  to match; ISO is unambiguous vs Stripe's epoch-seconds, given `uploadedAt` is
 *  epoch ms internally). */
export function versionBody(v: ReportVersionSummary, ctx: WireContext) {
  return {
    object: "version" as const,
    id: versionIdToWire(v.id),
    version_no: v.versionNo,
    uploaded_by: userIdToWire(v.uploadedBy),
    uploaded_at: new Date(v.uploadedAt).toISOString(),
    scan_status: v.scanStatus,
    size_bytes: v.sizeBytes,
    origin: v.origin,
    mode: ctx.mode,
  };
}

/** The Stripe-style list envelope: `{ object: "list", data: [...], has_more }`. */
export function listBody<T>(data: readonly T[], hasMore: boolean) {
  return { object: "list" as const, data, has_more: hasMore };
}

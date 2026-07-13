// Shared wire-shape builders (ADR-0053). Every resource is a flat snake_case object
// carrying an `object` type discriminator + `mode` + its prefixed External Id
// (ADR-0052); lists use the `{ object: "list", data: [...], has_more }` envelope.
// Errors stay RFC 9457 (ADR-0040). Mapping lives ONLY here, at the http boundary.
import type { ReportVersionSummary } from "arp-application";
import type { Comment, Folder, FolderId, ReportId, Slug } from "arp-domain";
import {
  commentIdToWire,
  folderIdToWire,
  reportIdToWire,
  userIdToWire,
  versionIdToWire,
} from "arp-domain";

/** Which deployment a resource belongs to (ADR-0053): the live product vs preview/dev. */
export type WireMode = "prod" | "dev";

/** Per-request wire context: the deployment `mode` stamped onto every resource.
 *  (Request-Id is a response header, set by the app boundary — not a body field.) */
export interface WireContext {
  readonly mode: WireMode;
}

/** A comment/version author's resolved display identity (ADR-0063 author display),
 *  folded onto the `author` wire object. Both fields are best-effort: `email` is
 *  null for a deleted/never-mirrored user; `name` is null when no display name is
 *  stored. Resolved in the route/DTO layer, never here. */
export interface WireAuthor {
  readonly email: string | null;
  readonly name: string | null;
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
export function versionBody(
  v: ReportVersionSummary,
  ctx: WireContext,
  author: WireAuthor | null = null,
) {
  return {
    object: "version" as const,
    id: versionIdToWire(v.id),
    version_no: v.versionNo,
    uploaded_by: userIdToWire(v.uploadedBy),
    // ADR-0063 author display: the uploader's resolvable identity. `id` mirrors
    // `uploaded_by` (kept intact, additive); `name` is the human display name when
    // stored (Clerk fullName/username), else null; `email` is the fallback identity
    // and is null for a deleted/never-mirrored user. Resolved in the route/DTO
    // layer, never here. Comments/versions are served ONLY on the authenticated,
    // org-scoped canWrite API — never the public viewer — so an in-org
    // collaborator's name/email is acceptable to surface.
    author: {
      id: userIdToWire(v.uploadedBy),
      email: author?.email ?? null,
      name: author?.name ?? null,
    },
    uploaded_at: new Date(v.uploadedAt).toISOString(),
    scan_status: v.scanStatus,
    size_bytes: v.sizeBytes,
    origin: v.origin,
    mode: ctx.mode,
  };
}

/** A `comment` resource (ADR-0064) — the Comment aggregate on the wire. `parent_id`
 *  is null for a root comment (starts a Thread), a `comment_…` External Id for a
 *  reply. `anchor.relative` is omitted when absent (v1: no editor slice yet, so
 *  every comment is version-pinned only). */
export function commentBody(c: Comment, ctx: WireContext, author: WireAuthor | null = null) {
  return {
    object: "comment" as const,
    id: commentIdToWire(c.id),
    report_id: reportIdToWire(c.reportId),
    author_id: userIdToWire(c.authorUserId),
    // ADR-0063 author display: mirrors `versionBody`'s `author`. `id` mirrors
    // `author_id` (kept intact, additive); `name` is the human display name when
    // stored, else null; `email` is the fallback identity (null for a
    // deleted/never-mirrored user). Filled in the route/DTO layer. Only ever
    // served on the authenticated org-scoped API, never public.
    author: {
      id: userIdToWire(c.authorUserId),
      email: author?.email ?? null,
      name: author?.name ?? null,
    },
    parent_id: c.parentCommentId ? commentIdToWire(c.parentCommentId) : null,
    body: c.body,
    intent: c.intent,
    anchor: {
      version_pinned: {
        version_id: versionIdToWire(c.anchor.versionPinned.versionId),
        text_quote: c.anchor.versionPinned.textQuote,
      },
      ...(c.anchor.relative !== undefined ? { relative: c.anchor.relative } : {}),
    },
    // When the comment was last edited (ADR-0064 §3), or null if never edited —
    // drives the client's "· edited" indicator, and the value a client echoes
    // back as the optimistic-concurrency token on its next edit. Additive: an
    // ISO-8601 date-time like `resolved_at`/`created_at`.
    edited_at: c.editedAt === null ? null : new Date(c.editedAt).toISOString(),
    resolved_at: c.resolvedAt === null ? null : new Date(c.resolvedAt).toISOString(),
    created_at: new Date(c.createdAt).toISOString(),
    mode: ctx.mode,
  };
}

/** The Stripe-style list envelope: `{ object: "list", data: [...], has_more }`. */
export function listBody<T>(data: readonly T[], hasMore: boolean) {
  return { object: "list" as const, data, has_more: hasMore };
}

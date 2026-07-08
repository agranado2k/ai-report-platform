// Comment→client DTO mapping (ADR-0064, editor comment UI slice). Shared by
// the reports.$slug.edit LOADER (the sidebar's initial list, ADR-0064 §4 —
// authenticated-surface-only read, never the public viewer) and the
// reports.$slug.comments ACTION's success responses. Wire-encodes ids via the
// same ADR-0052 External Id codec the /api/v1 comments route uses
// (arp-http's commentBody) — this is a distinct, camelCase, app-internal
// shape (not the ADR-0053 snake_case public resource), but the id ENCODING
// itself is the same codec, reused rather than reinvented.
import type { Comment } from "arp-domain";
import { commentIdToWire, versionIdToWire } from "arp-domain";

export interface CommentDto {
  readonly id: string;
  readonly parentId: string | null;
  readonly authorUserId: string;
  /** Best-effort author email (IdentityStore.findEmailByUserId) — null when
   *  not resolved by the caller (e.g. an action's success response, which
   *  doesn't pay that extra lookup; the loader's next revalidation fills it
   *  in). Never a security-relevant field — comments are already gated to
   *  users with report access (ADR-0064 §3/§4). */
  readonly authorEmail: string | null;
  readonly body: string;
  readonly anchor: {
    readonly versionId: string;
    readonly textQuote: string;
    readonly relative?: unknown;
  };
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export function commentToDto(c: Comment, authorEmail: string | null = null): CommentDto {
  return {
    id: commentIdToWire(c.id),
    parentId: c.parentCommentId ? commentIdToWire(c.parentCommentId) : null,
    authorUserId: c.authorUserId,
    authorEmail,
    body: c.body,
    anchor: {
      versionId: versionIdToWire(c.anchor.versionPinned.versionId),
      textQuote: c.anchor.versionPinned.textQuote,
      ...(c.anchor.relative !== undefined ? { relative: c.anchor.relative } : {}),
    },
    resolvedAt: c.resolvedAt === null ? null : new Date(c.resolvedAt).toISOString(),
    createdAt: new Date(c.createdAt).toISOString(),
  };
}

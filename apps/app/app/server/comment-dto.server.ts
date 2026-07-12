// Comment author-id dedupe for the comments Bearer list route (ADR-0063 author
// display). Mirrors version-dto.server.ts's `uniqueVersionAuthorIds`: collapse
// a page of comments to the UNIQUE author ids (first-seen order) so the route
// makes exactly ONE IdentityStore.findEmailByUserId round-trip per distinct
// author (via author-email.server.ts's `resolveAuthorEmails`), then lets the
// arp-http mapper fold each resolved email back onto its comment resource.
//
// Unlike version-dto.server.ts there is NO `commentsToDto` half here: the
// comments route serializes straight through arp-http's `commentBody`
// (packages/http/src/resource.ts) — the email map is passed to
// `listCommentsToHttp`, so the wire projection stays in one place.
import type { Comment, UserId } from "arp-domain";

/** The unique author ids across a page of comments, in first-seen order. */
export function uniqueCommentAuthorIds(
  comments: readonly Pick<Comment, "authorUserId">[],
): readonly UserId[] {
  return [...new Set(comments.map((c) => c.authorUserId))];
}

// Document-order sorting + degraded-anchor classification for the Comments
// panel (comment-UX adoptions, items C and D). Pure helpers, extracted from
// CommentsPanel so they're unit-testable without a DOM (same pattern as
// ./panel.ts / ./comment-format.ts — apps/view has no component test tier).
//
// The panel's wire order is newest-created-first — right for an API, wrong
// for a review read-through (the gap-analysis report's exact words). Roots
// are re-sorted client-side by where their anchor lives in the document:
//   1. the RESOLVED anchor position — the editor's own highlight resolution,
//      reported back via ReportEditor's onCommentRangesChange (so this module
//      never re-implements arp-editor's position rules);
//   2. falling back to the raw `relative.from` for a comment without a
//      resolved range (out-of-bounds but still carrying its original spot —
//      keeps a degraded comment near its old neighborhood);
//   3. falling back to created_at (then id, for a stable tiebreak) — a
//      position-less comment sorts AFTER every positioned one.
//
// Item D rides the same classification: an UNRESOLVED root with no resolved
// range is `degraded` — its relative anchor no longer resolves against the
// current document, so the panel badges it "pinned to version N" instead of
// rendering it identically to a live-anchored comment (ADR-0064 §2a's
// "surfaced in the UI as pinned to that version"). A RESOLVED thread is never
// flagged: resolved threads aren't in the highlight feed at all, so absence
// of a range says nothing about their anchor.
import type { CommentWire, VersionWire } from "./wire-types";

export interface OrderedRootComment {
  readonly comment: CommentWire;
  /** The anchor's resolved position in the current doc, or null. */
  readonly position: number | null;
  /** True when the (unresolved) comment's anchor failed to resolve — the
   *  version-pinned fallback state the panel must badge (item D). */
  readonly degraded: boolean;
}

/** The minimal range shape this module needs from arp-editor's
 *  `CommentRange` — structural, so the panel can pass ranges straight
 *  through without an import cycle on the editor package's types. */
export interface ResolvedRange {
  readonly commentId: string;
  readonly from: number;
}

function rawRelativeFrom(comment: CommentWire): number | null {
  const rel = comment.anchor.relative;
  if (typeof rel !== "object" || rel === null) return null;
  const from = (rel as Record<string, unknown>).from;
  return typeof from === "number" && Number.isFinite(from) ? from : null;
}

export function orderRootComments(
  comments: readonly CommentWire[],
  ranges: readonly ResolvedRange[],
): readonly OrderedRootComment[] {
  const positionById = new Map(ranges.map((r) => [r.commentId, r.from]));
  const roots = comments.filter((c) => c.parent_id === null);
  const ordered = roots.map((comment): OrderedRootComment => {
    const position = positionById.get(comment.id) ?? null;
    return {
      comment,
      position,
      degraded: comment.resolved_at === null && position === null,
    };
  });
  const sortKey = (o: OrderedRootComment): number =>
    o.position ?? rawRelativeFrom(o.comment) ?? Number.POSITIVE_INFINITY;
  return [...ordered].sort((a, b) => {
    // Explicit comparisons, not subtraction: both keys can be +Infinity
    // (position-less comments), and Infinity - Infinity is NaN — which a
    // comparator must never return.
    const keyA = sortKey(a);
    const keyB = sortKey(b);
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    const byCreated =
      new Date(a.comment.created_at).getTime() - new Date(b.comment.created_at).getTime();
    if (byCreated !== 0) return byCreated;
    return a.comment.id < b.comment.id ? -1 : a.comment.id > b.comment.id ? 1 : 0;
  });
}

/** The version NUMBER a degraded comment is pinned to, resolved from the
 *  versions list the route already loads — or null when the pinned version
 *  isn't in the list (the badge then omits the number rather than guessing). */
export function versionNoForPin(
  versions: readonly VersionWire[],
  versionId: string,
): number | null {
  return versions.find((v) => v.id === versionId)?.version_no ?? null;
}

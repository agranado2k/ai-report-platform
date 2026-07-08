// Comment highlight decorations (ADR-0064 §2a's `relative` slot, editor MVP).
// Best-effort: a comment's `{from,to}` relative position is rendered as a
// subtle inline highlight ONLY while it still resolves within the CURRENT
// doc's bounds; anything else — missing/malformed `relative`, or a range an
// edit has pushed out of bounds — is skipped SILENTLY here. The comment is
// never lost: it stays listed in the sidebar, showing as version-pinned
// (ADR-0064 §2a's degrade-gracefully design), just without a live highlight.
//
// `resolvableCommentRanges` is pure (no DOM, no ProseMirror state) so it's
// unit-tested directly; `commentHighlightsPlugin` wraps it for the mounted
// EditorView (ReportEditor.tsx dispatches `tr.setMeta(commentHighlightsKey,
// ranges)` whenever the comments list changes). An ordinary typing
// transaction carries no such meta, so the existing DecorationSet re-maps
// itself via ProseMirror's own position mapping (`old.map(...)`) instead of
// being recomputed from the raw comment list on every keystroke.
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export interface CommentRange {
  readonly commentId: string;
  readonly from: number;
  readonly to: number;
}

/** The shape this module needs from a comment for highlight resolution — just
 *  the id plus the anchor's opaque `relative` slot. Deliberately NOT the full
 *  `Comment` domain type: this module stays decoupled from arp-domain,
 *  matching the anchor's own "relative is opaque" design (ADR-0064 §2a). */
export interface CommentForHighlight {
  readonly id: string;
  readonly anchor: { readonly relative?: unknown };
}

/** Keep only the comments whose `relative` is a plausible `{from,to}` PM
 *  position pair that still resolves inside `[0, docSize]` with `from < to`.
 *  Everything else is filtered out, never thrown — a malformed or
 *  out-of-bounds anchor degrades to "no highlight", not an error. */
export function resolvableCommentRanges(
  docSize: number,
  comments: readonly CommentForHighlight[],
): CommentRange[] {
  const ranges: CommentRange[] = [];
  for (const c of comments) {
    const rel = c.anchor.relative;
    if (typeof rel !== "object" || rel === null) continue;
    const { from, to } = rel as Record<string, unknown>;
    if (typeof from !== "number" || typeof to !== "number") continue;
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
    if (from < 0 || to > docSize || from >= to) continue;
    ranges.push({ commentId: c.id, from, to });
  }
  return ranges;
}

const HIGHLIGHT_CLASS = "comment-highlight";

/** Plugin state key — exported so callers (ReportEditor.tsx, tests) can both
 *  dispatch the seeding meta and read the resulting DecorationSet back. */
export const commentHighlightsKey = new PluginKey<DecorationSet>("commentHighlights");

export function commentHighlightsPlugin(): Plugin {
  return new Plugin({
    key: commentHighlightsKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const ranges = tr.getMeta(commentHighlightsKey) as readonly CommentRange[] | undefined;
        if (ranges) {
          return DecorationSet.create(
            tr.doc,
            ranges.map((r) =>
              Decoration.inline(
                r.from,
                r.to,
                { class: HIGHLIGHT_CLASS },
                { commentId: r.commentId },
              ),
            ),
          );
        }
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return commentHighlightsKey.getState(state);
      },
    },
  });
}

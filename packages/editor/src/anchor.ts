// Client-side anchor capture: builds an ADR-0064 §2a Anchor payload from the
// editor's CURRENT text selection when the user selects text and clicks
// "Comment". Populates both slots the domain's `Anchor` value object expects
// (packages/domain/src/anchor.ts): the version-pinned fallback (always) and
// the optional `relative` {from,to} ProseMirror-position slot.
//
// JUDGMENT CALL (flagged per the task brief): `relative` here is a plain
// `{from,to}` position pair against the doc CURRENTLY OPEN in the editor —
// NOT yet edit-stable or Yjs-relative. ADR-0064 §2a / ADR-0067 describe a
// Yjs-relative-position-compatible shape for the future real-time
// collaboration transport, which doesn't exist yet; the domain's `relative`
// slot is deliberately `unknown` for exactly this reason (whichever layer
// eventually resolves/writes a relative position casts at its own boundary —
// this is that boundary, for v1). Degrades gracefully today via
// `resolvableCommentRanges` (comment-decorations.ts): an edit that shifts
// text re-maps the position through ProseMirror's own transaction mapping
// (handled by the mounted EditorView), and a comment whose range no longer
// resolves simply stops rendering a highlight — the comment itself is never
// lost, it just falls back to showing as version-pinned in the sidebar.

// Mirrors the domain's `anchor.ts` MAX_TEXT_QUOTE cap. This is a client-side
// courtesy truncation only — `validateAnchor` server-side is the authoritative
// enforcement, not this constant.
const TEXT_QUOTE_MAX = 2000;

export interface SelectionAnchorInput {
  readonly versionId: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface SelectionAnchor {
  readonly versionId: string;
  readonly textQuote: string;
  readonly relative: { readonly from: number; readonly to: number };
}

export function buildSelectionAnchor(input: SelectionAnchorInput): SelectionAnchor {
  const trimmed = input.text.trim();
  const textQuote = trimmed.length > TEXT_QUOTE_MAX ? trimmed.slice(0, TEXT_QUOTE_MAX) : trimmed;
  return {
    versionId: input.versionId,
    textQuote,
    relative: { from: input.from, to: input.to },
  };
}

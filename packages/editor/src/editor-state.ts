// Pure ProseMirror wiring for the report editor (ADR-0062 §1/§3, editor MVP —
// toolbar-free: typing + marks via keymap). Needs no DOM (unlike the mounted
// `EditorView`, which `ReportEditor.tsx` owns) — the state/transform layer of
// ProseMirror is plain JS, so this module is cheaply unit-testable (see
// editor-state.test.ts) even though the rest of the Remix UI stays e2e-only.

import { type PMDocJson, reportSchema } from "arp-report-html";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Node as PMNode, type ResolvedPos } from "prosemirror-model";
import type { Plugin, Selection, Transaction } from "prosemirror-state";
import { EditorState, TextSelection } from "prosemirror-state";
import {
  type CommentForHighlight,
  commentHighlightsPlugin,
  jumpTargetForComment,
} from "./comment-decorations";
import { trimSelectionBleed } from "./selection-trim";

/** Look up a mark type reportSchema is known to define (schema.ts builds on
 *  prosemirror-schema-basic, which always defines `strong`/`em`) — throws
 *  loudly on a schema regression instead of silently binding `undefined`. */
function requireMark(name: string) {
  const mark = reportSchema.marks[name];
  if (!mark) throw new Error(`reportSchema has no '${name}' mark`);
  return mark;
}

/** The keymap-bound plugins for the MVP editor: history (undo/redo), a
 *  handful of mark toggles (bold/italic), ProseMirror's baseKeymap
 *  (Enter/Backspace/Delete/arrow-key list handling, etc.), and the comment
 *  highlight decoration plugin (ADR-0064 §2a — comment-decorations.ts). No
 *  toolbar — every keymap binding here is reachable only by keyboard, per the
 *  MVP scope; the comment highlights are seeded/updated externally via
 *  `tr.setMeta(commentHighlightsKey, ranges)`, not a keymap command. */
export function editorPlugins(): Plugin[] {
  return [
    history(),
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Shift-Mod-z": redo,
      "Mod-b": toggleMark(requireMark("strong")),
      "Mod-i": toggleMark(requireMark("em")),
    }),
    keymap(baseKeymap),
    commentHighlightsPlugin(),
  ];
}

/** Build the initial editor state from the lossless `_source.json` doc JSON
 *  (ADR-0062 §4) — the shape `arp-report-html`'s `parseBody`/`PMDocJson`
 *  produce and `Node#toJSON()`/`Node.fromJSON()` (de)serialize. */
export function createEditorState(doc: PMDocJson): EditorState {
  const node = PMNode.fromJSON(reportSchema, doc);
  return EditorState.create({ doc: node, schema: reportSchema, plugins: editorPlugins() });
}

/** The current document as PM doc JSON — what gets persisted back as the
 *  `_source.json` sidecar on save. */
export function docJson(state: EditorState): PMDocJson {
  return state.doc.toJSON() as PMDocJson;
}

/** The editor's current text selection, forwarded to the caller so it can
 *  build an ADR-0064 anchor when the user clicks "Comment" (`from === to`
 *  means an empty/collapsed selection, reported as `null`). Lives here (not
 *  ReportEditor.tsx) so the pure selection-reporting gate below is testable
 *  without a DOM; ReportEditor re-exports it unchanged. */
export interface EditorSelection {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Transaction meta flag marking a PROGRAMMATIC selection (item B's "Jump").
 *  A transaction carrying it must never be reported as a pending selection —
 *  see `reportableSelection` below. */
const PROGRAMMATIC_SELECTION_META = "arp-editor$programmaticSelection";

/**
 * THE ONE WAY THIS EDITOR REVEALS A PLACE IN THE DOCUMENT: move the selection
 * there, flag the move as programmatic, and ask ProseMirror to scroll.
 *
 * Both revealers below route through this — the comment "Jump" and the in-page
 * anchor click — so "Jump and the anchor click use the same mechanism" is a
 * structural fact about this module rather than a claim in a comment that a
 * later edit can quietly falsify.
 *
 * Each of the three parts is load-bearing:
 *
 *  - `setSelection` is the reveal. A scroll performed behind ProseMirror's
 *    back leaves the caret pointing somewhere else, and the browser reveals
 *    the caret afterwards (see `anchorScrollTransaction` below) — so the only
 *    durable way to scroll is to make the place you want revealed the place
 *    the selection already is.
 *  - `.scrollIntoView()` is what makes ProseMirror scroll AT ALL. Its
 *    `updateStateInner` scrolls only when `state.scrollToSelection >
 *    prev.scrollToSelection`; a transaction without this call is a "preserve"
 *    update, and PM does nothing to bring the new selection into view.
 *  - the programmatic flag keeps `reportableSelection` from reporting the
 *    move as a pending comment selection: revealing must never start
 *    authoring (2026-07-29 dogfood paper cut #1).
 */
export function programmaticRevealTransaction(
  state: EditorState,
  selection: Selection,
): Transaction {
  return state.tr
    .setSelection(selection)
    .setMeta(PROGRAMMATIC_SELECTION_META, true)
    .scrollIntoView();
}

/** Build the "Jump" transaction (item B): resolve the comment against the
 *  CURRENT doc, select the anchored range (the visual "here it is" cue), and
 *  scroll it into view. Returns `null` when the comment's relative position
 *  no longer resolves (the degraded, version-pinned state — item D). */
export function jumpToCommentTransaction(
  state: EditorState,
  comment: CommentForHighlight,
): Transaction | null {
  const target = jumpTargetForComment(state.doc.content.size, comment);
  if (!target) return null;
  return programmaticRevealTransaction(
    state,
    TextSelection.create(state.doc, target.from, target.to),
  );
}

/**
 * Build the in-page ANCHOR transaction (ADR-0062 Amendment 3, Decision 7):
 * collapse the selection onto the anchor target's position and ask
 * ProseMirror to scroll it into view. Returns `null` when `pos` is not a
 * position the current doc can resolve.
 *
 * WHY THE SELECTION MOVES, rather than the anchor being scrolled to behind
 * ProseMirror's back.
 *
 * ESTABLISHED, from prosemirror-view 1.42.0's own source: `updateStateInner`
 * scrolls for a transaction ONLY when `state.scrollToSelection >
 * prev.scrollToSelection` — that is, only when the transaction called
 * `.scrollIntoView()`. Every other transaction, including the caret placement
 * a click produces, is a "preserve" update in which PM does nothing to bring
 * the new selection into view. A scroll issued behind PM's back therefore has
 * no standing at all: the caret stays on the TOC link, and the surface is left
 * free for whatever reveals that caret to move it.
 *
 * MEASURED IN CHROME: such a scroll loses whatever we do. `behavior: "smooth"`
 * loses worst — it is an abortable animation running for hundreds of ms (1.5s
 * over a long report), and any competing scroll on the same box abandons it
 * permanently, leaving the box at the competitor's offset. An instant scroll is
 * applied and then simply overridden. Deferring by more frames cannot help,
 * because the caret never stops being somewhere else.
 *
 * NOT ESTABLISHED — deliberately left open rather than replaced with a second
 * confident guess: WHICH mechanism performs the competing scroll. Two
 * candidates were checked against the installed source and REFUTED, so neither
 * should be repeated:
 *
 *  - `DOMObserver.flushSoon()`'s 20ms flush calling `view.scrollToSelection()`.
 *    The only such call inside `flush()` is gated on `Math.max(lastTouch,
 *    lastClick.time) < Date.now() - 300`, so it structurally cannot fire on
 *    the click under test.
 *  - `updateStateInner`'s preserve path (`storeScrollPos`/`resetScrollPos`)
 *    restoring the pre-transaction offset. It is guarded by
 *    `this.dom.style.overflowAnchor == null`, and Chrome supports
 *    `overflow-anchor`, so that property reads `""` there and the guard is
 *    false — the path never runs in the browser this was measured in.
 *
 * PM does re-sync its selection to the DOM about 20ms after a click
 * (`flushSoon` → `flush` → `selectionToDOM`), so a browser-side reveal of the
 * newly-set DOM selection fits the timeline; that is a description of WHEN,
 * not a verified WHY, and it is left as one.
 *
 * THE FIX DOES NOT DEPEND ON KNOWING. It works by making the anchor the place
 * the selection already is, and by putting `.scrollIntoView()` on the
 * transaction — the one input that makes PM's own update path scroll at all.
 * Once the caret is at the anchor, any later reveal of the caret RE-ASSERTS
 * the anchor scroll rather than undoing it. This is the same mechanism the
 * comment "Jump" has always used — structurally so: both go through
 * `programmaticRevealTransaction` above.
 *
 * NOT EVERY TARGET CAN BE REVEALED THIS WAY, and `null` is the answer for the
 * ones that cannot. `TextSelection.near` is not a `TextSelection` factory —
 * `TextSelection` inherits `near` from `Selection`, which returns whatever
 * kind of selection is valid NEAREST to the position. Two of its three
 * outcomes are wrong here and are refused:
 *
 *  - A **non-empty** selection: a `NodeSelection` over a block-level atom
 *    (`<hr id="divider">` is the only one `reportSchema` can reach today, but
 *    `withId` is swept over every node with a `toDOM`, so any block atom added
 *    later inherits this), or an `AllSelection` when nothing resolves at all.
 *    Dispatching either would leave the element carrying
 *    `.ProseMirror-selectednode` — and the user's next keystroke would REPLACE
 *    it. A scroll must never arm a destructive edit.
 *  - A caret that lands **outside the target's own node range**: an empty but
 *    legal container (`<section id="landing"></section>`) has no selectable
 *    position inside it, so `near` walks out to the following block. PM would
 *    then reveal a position past the anchor while the DOM fallback top-aligns
 *    the anchor itself — the original race, restored, for that class of
 *    target.
 *
 * Both refusals fall through to `deferAnchorScroll`'s plain DOM scroll
 * (link-activation.ts), which is the correct behavior for a target PM cannot
 * put a caret in.
 *
 * Flagged programmatic for the same reason Jump is: revealing a section must
 * never open the new-comment composer. Every selection this function actually
 * returns is collapsed — guaranteed by the emptiness refusal above, not merely
 * hoped for — so `reportableSelection` would return `null` anyway; the flag
 * states the intent rather than relying on that.
 */
export function anchorScrollTransaction(state: EditorState, pos: number): Transaction | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.content.size) return null;
  let $pos: ResolvedPos;
  try {
    $pos = state.doc.resolve(pos);
  } catch {
    return null; // an unresolvable position is "no anchor", never a throw.
  }
  const selection = TextSelection.near($pos);
  if (!selection.empty) return null;
  const target = anchorTargetRange($pos);
  if (selection.from < target.from || selection.from > target.to) return null;
  return programmaticRevealTransaction(state, selection);
}

/** The document range the anchor's own node occupies — the only region a
 *  caret may land in and still be "at the anchor".
 *
 *  `view.posAtDOM(element, 0)` reports one of two positions, both handled
 *  here: the position immediately BEFORE the node (ProseMirror's
 *  `localPosFromDOM` falls back to `posAtStart` for a leaf/atom, and for a
 *  wrapper whose `contentDOM` is not its `dom`), in which case `nodeAfter` IS
 *  the target; or a position just inside the node's own content, in which case
 *  the enclosing node is the target and its content range bounds the reveal. */
function anchorTargetRange($pos: ResolvedPos): { readonly from: number; readonly to: number } {
  const after = $pos.nodeAfter;
  if (after) return { from: $pos.pos, to: $pos.pos + after.nodeSize };
  return { from: $pos.start(), to: $pos.end() };
}

/** The selection a just-applied transaction should report to the caller as
 *  the PENDING (commentable) selection, or `null` — the pure gate behind
 *  ReportEditor's `onSelectionChange`. Null when the selection is collapsed
 *  (nothing to comment on) OR when the transaction was programmatic (a Jump
 *  must not trip the composer's pendingSelection gate). The reported range is
 *  bleed-trimmed (selection-trim.ts) and the quote is derived from the SAME
 *  trimmed range, so the stored anchor and its text_quote always agree
 *  (2026-07-29 dogfood paper cut #2). */
export function reportableSelection(tr: Transaction, state: EditorState): EditorSelection | null {
  if (tr.getMeta(PROGRAMMATIC_SELECTION_META)) return null;
  const { from, to } = state.selection;
  if (from === to) return null;
  const trimmed = trimSelectionBleed(state.doc, from, to);
  return {
    from: trimmed.from,
    to: trimmed.to,
    text: state.doc.textBetween(trimmed.from, trimmed.to, " "),
  };
}

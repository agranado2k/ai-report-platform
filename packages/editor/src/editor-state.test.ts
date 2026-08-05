// Behavior tests for the editor's pure ProseMirror wiring (ADR-0062 §1/§3):
// state creation from the lossless `_source.json` shape, and the exact
// command functions bound in `editorPlugins()`'s keymap (toggleMark, the
// baseKeymap's Enter → splitBlock) applied against a real `reportSchema`
// document. These exercise the SAME functions the editor binds to Mod-b /
// Enter — not reimplementations — without needing a mounted `EditorView` /
// DOM (ADR-024 doesn't apply here — this is UI/adapter code — but the
// state/transform layer of ProseMirror needs no DOM at all, so it's cheaply
// unit-testable; a real keyboard-driven `EditorView` is e2e territory).

import { type PMDocJson, parseBody, reportSchema, serializeBody } from "arp-report-html";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import type { Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  anchorScrollTransaction,
  createEditorState,
  docJson,
  jumpToCommentTransaction,
  programmaticRevealTransaction,
  reportableSelection,
} from "./editor-state";

// `attrs` mirrors what `reportSchema`'s paragraph spec (generic class/style
// retention + the `.desc`/`.lede`/`.sub` variant attr, ADR-0062 §3) fills in
// by default. Deliberately carries NO `id` key: this is the shape of a
// sidecar written BEFORE `withId` widened the retention set (ADR-0062
// Amendment 3), i.e. what every already-saved report's `_source.json` looks
// like on disk in R2 today.
const oneParagraphDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { class: null, style: null, variant: null },
      content: [{ type: "text", text: "hello world" }],
    },
  ],
};

// The same document as `Node#toJSON()` round-trips it TODAY — every node now
// also carries `id`, defaulting to null.
const oneParagraphDocJson = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { class: null, id: null, style: null, variant: null },
      content: [{ type: "text", text: "hello world" }],
    },
  ],
};

describe("createEditorState / docJson", () => {
  // Doubles as the FORWARD-COMPATIBILITY guarantee for ADR-0062 Amendment 3:
  // a pre-Amendment-3 sidecar (no `id` key anywhere) must still open in the
  // editor, with `id` defaulting to null rather than throwing on a missing
  // attr. Every report saved before this change is exactly that shape, so a
  // regression here would break opening ALL of them.
  it("round-trips a legacy (pre-id) PM doc JSON, defaulting the new id attr to null", () => {
    const state = createEditorState(oneParagraphDoc);
    expect(docJson(state)).toEqual(oneParagraphDocJson);
  });
});

describe("editorPlugins keymap commands", () => {
  it("toggleMark(strong), the command bound to Mod-b, wraps the selection in <strong> on save", () => {
    const state = createEditorState(oneParagraphDoc);
    // Select "hello" (doc positions 1..6 — position 1 is the first char inside
    // the paragraph's inline content).
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    const strongMark = reportSchema.marks.strong;
    if (!strongMark) throw new Error("reportSchema has no 'strong' mark");

    let next = selected;
    const applied = toggleMark(strongMark)(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<p><strong>hello</strong> world</p>");
  });

  it("Enter, the baseKeymap command bound in editorPlugins, splits one paragraph into two", () => {
    const state = createEditorState(oneParagraphDoc);
    const withCursor = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 6)), // between "hello" and " world"
    );

    let next = withCursor;
    // `baseKeymap.Enter` is exactly the command `editorPlugins()` binds to the
    // "Enter" key — calling it directly here (rather than synthesizing a real
    // DOM KeyboardEvent into a mounted EditorView) keeps this test DOM-free.
    const applied = baseKeymap.Enter?.(withCursor, (tr) => {
      next = withCursor.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<p>hello</p><p> world</p>");
  });
});

// Item B's "Jump" as a pure transaction builder, plus the selection-reporting
// gate (2026-07-29 dogfood paper cut #1): Jump selects the anchor range in
// the editor, which used to trip the composer's `pendingSelection` gate — the
// panel showed "Commenting on: <that comment's quote>" right after a Jump.
// A jump-originated (programmatic) selection must report NO pending selection
// — the visual range selection stays as the "here it is" cue; only the
// composer side-effect is suppressed.
describe("jumpToCommentTransaction / reportableSelection", () => {
  it("targets the anchor range and scrolls it into view", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = jumpToCommentTransaction(state, {
      id: "comment_1",
      anchor: { relative: { from: 1, to: 6 } },
      intent: "note",
    });
    expect(tr).not.toBeNull();
    if (!tr) throw new Error("unreachable");
    const next = state.apply(tr);
    expect(next.selection.from).toBe(1);
    expect(next.selection.to).toBe(6);
  });

  it("returns null for a degraded anchor (nothing live to jump to)", () => {
    const state = createEditorState(oneParagraphDoc);
    expect(
      jumpToCommentTransaction(state, { id: "c", anchor: { relative: { from: 5, to: 999 } } }),
    ).toBeNull();
    expect(jumpToCommentTransaction(state, { id: "c", anchor: {} })).toBeNull();
  });

  it("a jump-originated selection reports null (the composer must not open)", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = jumpToCommentTransaction(state, {
      id: "comment_1",
      anchor: { relative: { from: 1, to: 6 } },
      intent: "note",
    });
    if (!tr) throw new Error("unreachable");
    const next = state.apply(tr);
    expect(reportableSelection(tr, next)).toBeNull();
  });

  it("an ordinary user selection still reports {from,to,text}", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, 6));
    const next = state.apply(tr);
    expect(reportableSelection(tr, next)).toEqual({ from: 1, to: 6, text: "hello" });
  });
});

// THE ORDERING BUG, EXPRESSED AS AN INVARIANT (ADR-0062 Amendment 3,
// Decision 7). An in-page anchor click used to be a RACE against
// ProseMirror: the click left the selection on the TOC link, we scrolled the
// document elsewhere a frame later, and PM's post-click DOM/selection re-sync
// — which `DOMObserver.flushSoon()` defers on a 20ms timeout, i.e. AFTER a
// 16ms animation frame — then revealed the caret again and pulled the
// document straight back to the link. Measured in Chrome: whatever scroll the
// caret reveal performs WINS, whether our scroll was smooth (abandoned
// mid-animation) or instant (already applied, then overridden). No number of
// extra frames fixes that, because the caret never stops being somewhere
// else.
//
// So don't race the caret — MOVE it. Once the selection is at the anchor,
// PM's own reveal is the anchor scroll, and every later re-sync re-asserts it
// instead of undoing it. Same mechanism the comment "Jump" already uses in
// production (`jumpToCommentTransaction`), which is why that one never had
// this bug.
describe("anchorScrollTransaction — the anchor scroll PM performs, not one it fights", () => {
  it("puts the selection AT the anchor so a later caret reveal reveals the anchor", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = anchorScrollTransaction(state, 6);
    expect(tr).not.toBeNull();
    if (!tr) throw new Error("unreachable");
    const next = state.apply(tr);
    // Collapsed AT the target: nothing is left pointing at the link, so
    // there is no competing position for PM to scroll back to.
    expect(next.selection.from).toBe(6);
    expect(next.selection.empty).toBe(true);
  });

  it("asks ProseMirror to scroll — the reveal and the anchor scroll are one scroll", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = anchorScrollTransaction(state, 6);
    if (!tr) throw new Error("unreachable");
    expect(tr.scrolledIntoView).toBe(true);
  });

  it("is programmatic — jumping to a section must not open the comment composer", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = anchorScrollTransaction(state, 6);
    if (!tr) throw new Error("unreachable");
    expect(reportableSelection(tr, state.apply(tr))).toBeNull();
  });

  it("returns null for a position the current doc cannot resolve", () => {
    const state = createEditorState(oneParagraphDoc);
    expect(anchorScrollTransaction(state, 999)).toBeNull();
    expect(anchorScrollTransaction(state, -1)).toBeNull();
    expect(anchorScrollTransaction(state, Number.NaN)).toBeNull();
  });
});

/** Where the anchor-carrying node starts, i.e. the position `posAtDOM` reports
 *  for its element. Derived from the document rather than hard-coded, so the
 *  cases below keep meaning what they say if the schema's node sizes change. */
function anchorPosition(doc: PMDocJson, id: string): number {
  const { doc: node } = createEditorState(doc);
  const positions: number[] = [];
  node.descendants((child, pos) => {
    if (child.attrs.id === id) positions.push(pos);
    return true;
  });
  const first = positions[0];
  if (first === undefined) throw new Error(`no node in the fixture carries id="${id}"`);
  return first;
}

// NOT EVERY ANCHOR TARGET CAN BE REVEALED BY MOVING THE CARET, and the two
// failure modes below are both worse than doing nothing.
//
// `TextSelection.near` is not a `TextSelection` factory — `TextSelection`
// inherits `near` from `Selection`, so it returns whatever kind of selection
// is valid nearest to the position: a NODE selection over a block-level atom,
// an `AllSelection` when nothing resolves, or a caret in a textblock that may
// be nowhere near the element the user clicked towards. Only the last of those
// is an anchor reveal; the other two must fall through to the DOM-scroll
// fallback (`deferAnchorScroll`), which is exactly what a `null` return does.
describe("anchorScrollTransaction — only a caret INSIDE the target counts as a reveal", () => {
  const withBlockAtom = parseBody('<p>alpha</p><hr id="divider"><p>omega</p>');
  const withEmptyContainer = parseBody('<p>alpha</p><section id="landing"></section><p>omega</p>');

  it("refuses a block atom rather than NODE-SELECTING it", () => {
    const state = createEditorState(withBlockAtom);
    const pos = anchorPosition(withBlockAtom, "divider");

    // The hazard, stated as a fact about ProseMirror rather than a worry:
    // what resolves here is a NodeSelection over the rule itself. Dispatching
    // it would leave `<hr id="divider">` carrying `.ProseMirror-selectednode`
    // — and the user's very next keystroke would REPLACE the element.
    // `horizontal_rule` is the only reachable block atom in `reportSchema`
    // today, but `withId` is swept over every node with a `toDOM`, so any
    // block atom added later inherits both the anchor and this hazard.
    const resolved = TextSelection.near(state.doc.resolve(pos));
    expect(resolved.empty).toBe(false);

    expect(anchorScrollTransaction(state, pos)).toBeNull();
  });

  it("refuses a target whose nearest textblock lies OUTSIDE it", () => {
    const state = createEditorState(withEmptyContainer);
    const pos = anchorPosition(withEmptyContainer, "landing");
    const size = state.doc.nodeAt(pos)?.nodeSize ?? 0;

    // `<section id="landing"></section>` is a legal empty container
    // (`content: "block*"`) and a perfectly ordinary way to anchor a spot in
    // a report. PM's nearest selectable position is in the FOLLOWING
    // paragraph — an EMPTY selection, so the collapsed check alone waves it
    // through, and PM would then reveal a position past the target while the
    // DOM fallback top-aligns the target itself. That is the original race,
    // restored, for this whole class of anchor.
    //
    // Both positions `posAtDOM(element, 0)` can report are covered: the one
    // BEFORE the node (leaf/atom nodes, and wrappers whose `contentDOM` is
    // not their `dom`) and the one just inside its content.
    for (const candidate of [pos, pos + 1]) {
      const resolved = TextSelection.near(state.doc.resolve(candidate));
      expect(resolved.empty).toBe(true);
      expect(resolved.from).toBeGreaterThan(pos + size); // past the section entirely
      expect(anchorScrollTransaction(state, candidate)).toBeNull();
    }
  });

  it("still reveals an ordinary section anchor, with the caret inside it", () => {
    const doc = parseBody('<p>alpha</p><section id="deep"><h2>Deep</h2><p>body</p></section>');
    const state = createEditorState(doc);
    const pos = anchorPosition(doc, "deep");
    const size = state.doc.nodeAt(pos)?.nodeSize ?? 0;

    const tr = anchorScrollTransaction(state, pos);
    if (!tr) throw new Error("the ordinary anchor case must still produce a transaction");
    const next = state.apply(tr);
    expect(next.selection.empty).toBe(true);
    expect(next.selection.from).toBeGreaterThan(pos);
    expect(next.selection.from).toBeLessThan(pos + size);
  });
});

// "Jump and the anchor click use the same mechanism" was, until now, a claim
// in a comment. These pin it as a property of the code: both callers are
// `programmaticRevealTransaction` with a different selection, and nothing
// else. A future edit that gives either one its own bespoke transaction
// (dropping `.scrollIntoView()`, say, which is the ONLY thing that makes
// ProseMirror scroll) fails here rather than shipping and being discovered in
// production a second time.
describe("programmaticRevealTransaction — one reveal mechanism, two callers", () => {
  const state = createEditorState(oneParagraphDoc);

  /** The three properties that make a transaction a REVEAL rather than an
   *  ordinary selection change. */
  function revealShape(tr: Transaction) {
    return {
      scrollsIntoView: tr.scrolledIntoView,
      suppressesTheComposer: reportableSelection(tr, state.apply(tr)) === null,
      from: tr.selection.from,
      to: tr.selection.to,
    };
  }

  it("Jump is the shared reveal over the comment's anchored range", () => {
    const jump = jumpToCommentTransaction(state, {
      id: "comment_1",
      anchor: { relative: { from: 1, to: 6 } },
      intent: "note",
    });
    if (!jump) throw new Error("unreachable");
    expect(revealShape(jump)).toEqual(
      revealShape(programmaticRevealTransaction(state, TextSelection.create(state.doc, 1, 6))),
    );
  });

  it("the anchor click is the shared reveal over the anchor's position", () => {
    const anchor = anchorScrollTransaction(state, 6);
    if (!anchor) throw new Error("unreachable");
    expect(revealShape(anchor)).toEqual(
      revealShape(programmaticRevealTransaction(state, TextSelection.near(state.doc.resolve(6)))),
    );
  });
});

describe("editor-state misc", () => {
  it("an ordinary user selection still reports {from,to,text} (regression guard)", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, 6));
    const next = state.apply(tr);
    expect(reportableSelection(tr, next)).toEqual({ from: 1, to: 6, text: "hello" });
  });

  it("a collapsed selection reports null (nothing to comment on)", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 3));
    const next = state.apply(tr);
    expect(reportableSelection(tr, next)).toBeNull();
  });
});

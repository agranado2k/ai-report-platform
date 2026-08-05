// Behavior tests for the editor's pure ProseMirror wiring (ADR-0062 §1/§3):
// state creation from the lossless `_source.json` shape, and the exact
// command functions bound in `editorPlugins()`'s keymap (toggleMark, the
// baseKeymap's Enter → splitBlock) applied against a real `reportSchema`
// document. These exercise the SAME functions the editor binds to Mod-b /
// Enter — not reimplementations — without needing a mounted `EditorView` /
// DOM (ADR-024 doesn't apply here — this is UI/adapter code — but the
// state/transform layer of ProseMirror needs no DOM at all, so it's cheaply
// unit-testable; a real keyboard-driven `EditorView` is e2e territory).

import { reportSchema, serializeBody } from "arp-report-html";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  createEditorState,
  docJson,
  jumpToCommentTransaction,
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

  it("a collapsed selection reports null (nothing to comment on)", () => {
    const state = createEditorState(oneParagraphDoc);
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 3));
    const next = state.apply(tr);
    expect(reportableSelection(tr, next)).toBeNull();
  });
});

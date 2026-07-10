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
import { createEditorState, docJson } from "./editor-state";

// `attrs` mirrors what `reportSchema`'s paragraph spec (generic class/style
// retention + the `.desc`/`.lede`/`.sub` variant attr, ADR-0062 §3) fills in
// by default — the exact shape `Node#toJSON()` round-trips to.
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

describe("createEditorState / docJson", () => {
  it("round-trips a PM doc JSON with no edits applied", () => {
    const state = createEditorState(oneParagraphDoc);
    expect(docJson(state)).toEqual(oneParagraphDoc);
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

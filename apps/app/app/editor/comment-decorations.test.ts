// Behavior tests for the comment-highlight decoration logic (ADR-0064 §2a's
// `relative` slot, editor MVP): the pure in/out-of-bounds resolution
// (`resolvableCommentRanges`) and the ProseMirror plugin that turns resolved
// ranges into a `DecorationSet`. Both run without a DOM — `EditorState.apply`
// and `DecorationSet` are plain JS, same rationale as editor-state.test.ts.
import { reportSchema } from "arp-report-html";
import { Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  commentHighlightsKey,
  commentHighlightsPlugin,
  resolvableCommentRanges,
} from "./comment-decorations";

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

describe("resolvableCommentRanges", () => {
  const docSize = 13; // "<p>hello world</p>" as a PM doc: content.size = 13

  it("keeps a comment whose relative {from,to} resolves within the doc", () => {
    const ranges = resolvableCommentRanges(docSize, [
      { id: "comment_1", anchor: { relative: { from: 1, to: 6 } } },
    ]);
    expect(ranges).toEqual([{ commentId: "comment_1", from: 1, to: 6 }]);
  });

  it("skips a comment whose relative range extends past the doc's end", () => {
    const ranges = resolvableCommentRanges(docSize, [
      { id: "comment_2", anchor: { relative: { from: 5, to: 999 } } },
    ]);
    expect(ranges).toEqual([]);
  });

  it("skips a comment with no relative slot (version-pinned only)", () => {
    const ranges = resolvableCommentRanges(docSize, [{ id: "comment_3", anchor: {} }]);
    expect(ranges).toEqual([]);
  });

  it("skips a comment whose relative shape is malformed (not {from,to} numbers)", () => {
    const ranges = resolvableCommentRanges(docSize, [
      { id: "comment_4", anchor: { relative: { from: "1", to: 6 } } },
      { id: "comment_5", anchor: { relative: "not an object" } },
      { id: "comment_6", anchor: { relative: null } },
    ]);
    expect(ranges).toEqual([]);
  });

  it("skips a degenerate or inverted range (from >= to)", () => {
    const ranges = resolvableCommentRanges(docSize, [
      { id: "comment_7", anchor: { relative: { from: 6, to: 6 } } },
      { id: "comment_8", anchor: { relative: { from: 8, to: 2 } } },
    ]);
    expect(ranges).toEqual([]);
  });

  it("skips a from at or below the doc boundary (0 or negative), even if to is in-bounds", () => {
    const ranges = resolvableCommentRanges(docSize, [
      { id: "comment_9", anchor: { relative: { from: -1, to: 5 } } },
      { id: "comment_10", anchor: { relative: { from: 0, to: 5 } } },
    ]);
    expect(ranges).toEqual([]);
  });

  it("resolves multiple comments independently, keeping only the in-bounds ones", () => {
    const ranges = resolvableCommentRanges(docSize, [
      { id: "ok-1", anchor: { relative: { from: 1, to: 3 } } },
      { id: "oob-1", anchor: { relative: { from: 0, to: 5000 } } },
      { id: "ok-2", anchor: { relative: { from: 7, to: 12 } } },
    ]);
    expect(ranges).toEqual([
      { commentId: "ok-1", from: 1, to: 3 },
      { commentId: "ok-2", from: 7, to: 12 },
    ]);
  });
});

describe("commentHighlightsPlugin", () => {
  function stateWithPlugin() {
    const node = PMNode.fromJSON(reportSchema, oneParagraphDoc);
    return EditorState.create({
      doc: node,
      schema: reportSchema,
      plugins: [commentHighlightsPlugin()],
    });
  }

  it("starts with an empty decoration set", () => {
    const state = stateWithPlugin();
    const decorations = commentHighlightsKey.getState(state);
    expect(decorations?.find()).toEqual([]);
  });

  it("populates decorations at the given ranges when dispatched via plugin meta", () => {
    const state = stateWithPlugin();
    const next = state.apply(
      state.tr.setMeta(commentHighlightsKey, [{ commentId: "comment_1", from: 1, to: 6 }]),
    );
    const decorations = commentHighlightsKey.getState(next);
    const found = decorations?.find();
    expect(found).toHaveLength(1);
    expect(found?.[0]?.from).toBe(1);
    expect(found?.[0]?.to).toBe(6);
  });

  it("re-maps existing decorations across an unrelated edit (no meta on that transaction)", () => {
    const state = stateWithPlugin();
    const seeded = state.apply(
      state.tr.setMeta(commentHighlightsKey, [{ commentId: "comment_1", from: 1, to: 6 }]),
    );
    // Insert two characters at the very start of the doc — the highlighted
    // range should shift right by 2, re-mapped automatically (no new meta).
    const edited = seeded.apply(seeded.tr.insertText("ab", 1));
    const decorations = commentHighlightsKey.getState(edited);
    const found = decorations?.find();
    expect(found).toHaveLength(1);
    expect(found?.[0]?.from).toBe(3);
    expect(found?.[0]?.to).toBe(8);
  });
});

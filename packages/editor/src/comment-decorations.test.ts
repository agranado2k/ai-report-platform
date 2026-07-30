// Behavior tests for the comment-highlight decoration logic (ADR-0064 §2a's
// `relative` slot, editor MVP): the pure in/out-of-bounds resolution
// (`resolvableCommentRanges`) and the ProseMirror plugin that turns resolved
// ranges into a `DecorationSet`. Both run without a DOM — `EditorState.apply`
// and `DecorationSet` are plain JS, same rationale as editor-state.test.ts.
// Intent coloring (comment-UX adoptions, item A): ranges carry the comment's
// normalized intent, and each decoration gains a `--<intent>` class modifier.
import { reportSchema } from "arp-report-html";
import { Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  clickedCommentId,
  commentHighlightsKey,
  commentHighlightsPlugin,
  commentIdAtPos,
  jumpTargetForComment,
  resolvableCommentRanges,
} from "./comment-decorations";
import { createEditorState } from "./editor-state";

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
    expect(ranges).toEqual([{ commentId: "comment_1", from: 1, to: 6, intent: "note" }]);
  });

  it("carries each comment's intent through to its range", () => {
    const ranges = resolvableCommentRanges(docSize, [
      { id: "c-add", anchor: { relative: { from: 1, to: 3 } }, intent: "add" },
      { id: "c-remove", anchor: { relative: { from: 4, to: 6 } }, intent: "remove" },
      { id: "c-enh", anchor: { relative: { from: 7, to: 9 } }, intent: "enhancement" },
    ]);
    expect(ranges.map((r) => r.intent)).toEqual(["add", "remove", "enhancement"]);
  });

  it("normalizes an unknown or missing intent to `note` (never an unpaintable range)", () => {
    const ranges = resolvableCommentRanges(docSize, [
      { id: "c-unknown", anchor: { relative: { from: 1, to: 3 } }, intent: "shout" },
      { id: "c-missing", anchor: { relative: { from: 4, to: 6 } } },
    ]);
    expect(ranges.map((r) => r.intent)).toEqual(["note", "note"]);
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
      { commentId: "ok-1", from: 1, to: 3, intent: "note" },
      { commentId: "ok-2", from: 7, to: 12, intent: "note" },
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
      state.tr.setMeta(commentHighlightsKey, [
        { commentId: "comment_1", from: 1, to: 6, intent: "note" },
      ]),
    );
    const decorations = commentHighlightsKey.getState(next);
    const found = decorations?.find();
    expect(found).toHaveLength(1);
    expect(found?.[0]?.from).toBe(1);
    expect(found?.[0]?.to).toBe(6);
  });

  it("renders each decoration with the base class plus its intent color modifier", () => {
    const state = stateWithPlugin();
    const next = state.apply(
      state.tr.setMeta(commentHighlightsKey, [
        { commentId: "comment_1", from: 1, to: 3, intent: "remove" },
        { commentId: "comment_2", from: 7, to: 9, intent: "note" },
      ]),
    );
    const found = commentHighlightsKey.getState(next)?.find() ?? [];
    // `Decoration.inline`'s attrs live on `.type.attrs` (not part of PM's
    // public typings) — read via a structural cast, same trick as `.spec`.
    const classes = found.map(
      (d) => (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class,
    );
    expect(classes).toContain("comment-highlight comment-highlight--remove");
    expect(classes).toContain("comment-highlight comment-highlight--note");
  });

  it("resolves a click position back to its comment id (bidirectional linking, item B)", () => {
    const state = stateWithPlugin();
    const next = state.apply(
      state.tr.setMeta(commentHighlightsKey, [
        { commentId: "comment_1", from: 1, to: 6, intent: "note" },
        { commentId: "comment_2", from: 8, to: 12, intent: "add" },
      ]),
    );
    const decorations = commentHighlightsKey.getState(next);
    expect(commentIdAtPos(decorations, 3)).toBe("comment_1");
    expect(commentIdAtPos(decorations, 9)).toBe("comment_2");
  });

  it("returns null for a click outside every highlight, or with no decoration set", () => {
    const state = stateWithPlugin();
    const next = state.apply(
      state.tr.setMeta(commentHighlightsKey, [
        { commentId: "comment_1", from: 1, to: 3, intent: "note" },
      ]),
    );
    const decorations = commentHighlightsKey.getState(next);
    expect(commentIdAtPos(decorations, 10)).toBeNull();
    expect(commentIdAtPos(undefined, 2)).toBeNull();
  });

  it("re-maps existing decorations across an unrelated edit (no meta on that transaction)", () => {
    const state = stateWithPlugin();
    const seeded = state.apply(
      state.tr.setMeta(commentHighlightsKey, [
        { commentId: "comment_1", from: 1, to: 6, intent: "note" },
      ]),
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

// Regression for the 2026-07-29 dogfood E3 escalation: on live Chrome the
// click-highlight → panel-focus path was DEAD even though `commentIdAtPos`'s
// unit tests passed. Root cause: ProseMirror's internal `MouseDown` click
// tracker (the machinery behind the `handleClick` prop) is destroyed by a
// Chrome-synthesized `mousemove` with `buttons === 0` delivered between
// mousedown and mouseup inside the editor's sandboxed iframe — so PM's
// `handleClick` is never consulted, while native caret placement still works
// (which is why every OTHER editor interaction passed). The fix routes the
// affordance through raw DOM events (`handleDOMEvents` mousedown + click)
// with our own movement-slop check; `clickedCommentId` is that decision
// logic, tested here against a REAL `createEditorState` plugin stack (the
// full seeded-plugin seam the old tests never crossed).
describe("clickedCommentId", () => {
  function seededState() {
    const state = createEditorState(oneParagraphDoc);
    return state.apply(
      state.tr.setMeta(commentHighlightsKey, [
        { commentId: "comment_1", from: 1, to: 6, intent: "note" },
      ]),
    );
  }
  const posInside = () => ({ pos: 3 });
  const posOutside = () => ({ pos: 10 });

  it("resolves a stationary click inside a highlight to its comment id", () => {
    const decorations = commentHighlightsKey.getState(seededState());
    expect(clickedCommentId(decorations, { x: 40, y: 12 }, { x: 40, y: 12 }, posInside)).toBe(
      "comment_1",
    );
  });

  it("tolerates sub-slop jitter between mousedown and click (a real finger/mouse press)", () => {
    const decorations = commentHighlightsKey.getState(seededState());
    expect(clickedCommentId(decorations, { x: 40, y: 12 }, { x: 43, y: 14 }, posInside)).toBe(
      "comment_1",
    );
  });

  it("ignores a drag (movement beyond the slop): selecting text must not focus a comment", () => {
    const decorations = commentHighlightsKey.getState(seededState());
    expect(clickedCommentId(decorations, { x: 40, y: 12 }, { x: 90, y: 12 }, posInside)).toBeNull();
  });

  it("returns null for a click outside every highlight", () => {
    const decorations = commentHighlightsKey.getState(seededState());
    expect(
      clickedCommentId(decorations, { x: 200, y: 12 }, { x: 200, y: 12 }, posOutside),
    ).toBeNull();
  });

  it("returns null when no mousedown was tracked (e.g. a synthetic click event)", () => {
    const decorations = commentHighlightsKey.getState(seededState());
    expect(clickedCommentId(decorations, null, { x: 40, y: 12 }, posInside)).toBeNull();
  });

  it("returns null when the coordinates resolve to no document position", () => {
    const decorations = commentHighlightsKey.getState(seededState());
    expect(
      clickedCommentId(decorations, { x: 40, y: 12 }, { x: 40, y: 12 }, () => null),
    ).toBeNull();
  });
});

describe("jumpTargetForComment", () => {
  const docSize = 13;

  it("resolves a live-anchored comment to its {from,to} jump target", () => {
    const target = jumpTargetForComment(docSize, {
      id: "comment_1",
      anchor: { relative: { from: 2, to: 7 } },
      intent: "add",
    });
    expect(target).toEqual({ commentId: "comment_1", from: 2, to: 7, intent: "add" });
  });

  it("returns null when the relative position no longer resolves (degraded anchor)", () => {
    expect(
      jumpTargetForComment(docSize, { id: "c", anchor: { relative: { from: 5, to: 999 } } }),
    ).toBeNull();
    expect(jumpTargetForComment(docSize, { id: "c", anchor: {} })).toBeNull();
  });
});

// Behavior tests for the cross-inline-node selection-bleed trim (2026-07-29
// dogfood paper cut #2). Double-click word selection extends into an adjacent
// inline node when no whitespace separates them in the doc model — the report
// observed stored quotes like "ergonomicsAdopt" / "keeps highlightsA" (a chip
// badge abutting the paragraph text). `trimSelectionBleed` cuts the anchor
// back to the boundary of the node containing the MAJORITY of the selection,
// but ONLY for that abutting-fragment shape — genuine multi-node selections
// (spanning bold/links mid-sentence, cross-block ranges) must pass through
// untouched. Runs DOM-free against real reportSchema docs, same rationale as
// editor-state.test.ts.
import { TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { createEditorState, reportableSelection } from "./editor-state";
import { trimSelectionBleed } from "./selection-trim";

const para = (content: unknown[]) => ({
  type: "paragraph",
  attrs: { class: null, style: null, variant: null },
  content,
});
const text = (t: string) => ({ type: "text", text: t });
const chip = (t: string) => ({
  type: "text",
  text: t,
  marks: [{ type: "chip", attrs: { variant: "now" } }],
});
const bold = (t: string) => ({ type: "text", text: t, marks: [{ type: "strong" }] });
const docOf = (...content: unknown[]) => ({ type: "doc", content });

describe("trimSelectionBleed", () => {
  it("trims a trailing chip fragment that abuts the majority text (ergonomicsAdopt)", () => {
    // <p>Team ergonomics[chip:Adopt]</p> — "ergonomics" is 6..16, "Adopt" 16..21.
    const state = createEditorState(docOf(para([text("Team ergonomics"), chip("Adopt")])));
    expect(trimSelectionBleed(state.doc, 6, 21)).toEqual({ from: 6, to: 16 });
  });

  it("trims a leading chip fragment when the majority is the trailing node", () => {
    // <p>[chip:v2]release notes</p> — "v2" is 1..3, "release notes" 3..16.
    const state = createEditorState(docOf(para([chip("v2"), text("release notes")])));
    // Selection "v2release" (1..10): the chip is the abutting minority.
    expect(trimSelectionBleed(state.doc, 1, 10)).toEqual({ from: 3, to: 10 });
  });

  it("trims a single-character bleed (keeps highlightsA)", () => {
    const state = createEditorState(docOf(para([text("keeps highlights"), chip("Always")])));
    // "keeps highlights" is 1..17; select one char into the chip (1..18).
    expect(trimSelectionBleed(state.doc, 1, 18)).toEqual({ from: 1, to: 17 });
  });

  it("preserves a cross-node selection with whitespace at the junction", () => {
    // <p>keeps <strong>highlights</strong></p> — a genuine mid-sentence span.
    const state = createEditorState(docOf(para([text("keeps "), bold("highlights")])));
    expect(trimSelectionBleed(state.doc, 1, 17)).toEqual({ from: 1, to: 17 });
  });

  it("preserves a selection whose minority side is a real phrase (contains whitespace)", () => {
    const state = createEditorState(docOf(para([text("prefix-words-here"), chip("two words")])));
    expect(trimSelectionBleed(state.doc, 1, 27)).toEqual({ from: 1, to: 27 });
  });

  it("preserves a selection spanning three or more inline nodes", () => {
    const state = createEditorState(docOf(para([text("alpha"), bold("beta"), text("gamma")])));
    expect(trimSelectionBleed(state.doc, 1, 15)).toEqual({ from: 1, to: 15 });
  });

  it("preserves an even split (no majority to trim to)", () => {
    const state = createEditorState(docOf(para([text("ab"), chip("cd")])));
    expect(trimSelectionBleed(state.doc, 1, 5)).toEqual({ from: 1, to: 5 });
  });

  it("preserves a cross-block selection (different parents are not a bleed)", () => {
    const state = createEditorState(docOf(para([text("hello")]), para([text("world")])));
    // p1 text is 1..6, p2 text is 8..13 — span from inside p1 into p2.
    expect(trimSelectionBleed(state.doc, 2, 10)).toEqual({ from: 2, to: 10 });
  });

  it("passes a single-node selection through untouched", () => {
    const state = createEditorState(docOf(para([text("hello world")])));
    expect(trimSelectionBleed(state.doc, 1, 6)).toEqual({ from: 1, to: 6 });
  });
});

describe("reportableSelection applies the bleed trim", () => {
  it("reports the TRIMMED range and a quote that agrees with it", () => {
    const state = createEditorState(docOf(para([text("Team ergonomics"), chip("Adopt")])));
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 6, 21));
    const next = state.apply(tr);
    // Stored range and quote must agree after trimming (dogfood paper cut #2).
    expect(reportableSelection(tr, next)).toEqual({ from: 6, to: 16, text: "ergonomics" });
  });
});

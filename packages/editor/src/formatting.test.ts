// Behavior tests for the Selection toolbar's formatting seam (ticket #297):
// the pure active-state reading (which marks / block types the current
// selection carries — strong, em, link, heading level, list kind) and the
// toggle-command wrappers the toolbar buttons dispatch. Same DOM-free
// state/transform testing approach as editor-state.test.ts: real
// `reportSchema` documents built by the REAL `parseBody`, the REAL
// prosemirror-commands `toggleMark` underneath — never reimplementations.
import { parseBody, serializeBody } from "arp-report-html";
import { TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { createEditorState, docJson } from "./editor-state";
import { activeFormats, toggleFormatCommand } from "./formatting";

/** State over `bodyHtml` with `[from, to]` selected (collapsed when equal). */
function stateWithSelection(bodyHtml: string, from: number, to: number = from) {
  const state = createEditorState(parseBody(bodyHtml));
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

describe("activeFormats — marks", () => {
  it("reports strong active for a selection inside bold text, everything else inactive", () => {
    // <p><strong>hello</strong> world</p> — "hello" spans positions 1..6.
    const state = stateWithSelection("<p><strong>hello</strong> world</p>", 1, 6);
    expect(activeFormats(state)).toEqual({
      strong: true,
      em: false,
      link: false,
      headingLevel: null,
      listKind: null,
    });
  });

  it("reports em over italic text and link over linked text", () => {
    const em = stateWithSelection("<p><em>hello</em> world</p>", 1, 6);
    expect(activeFormats(em).em).toBe(true);
    expect(activeFormats(em).strong).toBe(false);

    const link = stateWithSelection('<p><a href="https://example.com">hello</a> world</p>', 1, 6);
    expect(activeFormats(link).link).toBe(true);
  });

  it("reports nothing active over plain text", () => {
    const state = stateWithSelection("<p>hello world</p>", 1, 6);
    expect(activeFormats(state)).toEqual({
      strong: false,
      em: false,
      link: false,
      headingLevel: null,
      listKind: null,
    });
  });

  it("a cursor inside bold text reads strong active — arriving in existing bold lights the button", () => {
    const state = stateWithSelection("<p><strong>hello</strong> world</p>", 3);
    expect(activeFormats(state).strong).toBe(true);
    expect(activeFormats(state).em).toBe(false);
  });

  it("a cursor honors storedMarks over the position's own marks (mid-typing toggle state)", () => {
    const strongMark = createEditorState(parseBody("<p>x</p>")).schema.marks.strong;
    if (!strongMark) throw new Error("no strong mark");
    const base = stateWithSelection("<p>hello world</p>", 3);
    const stored = base.apply(base.tr.addStoredMark(strongMark.create()));
    expect(activeFormats(stored).strong).toBe(true);
  });

  it("a range PARTIALLY covered by a mark reads active — matching what a toggle on it would clear", () => {
    // toggleMark on a range where the mark appears anywhere REMOVES it, so
    // "anywhere in range" is the honest active reading (the PM menu convention).
    const state = stateWithSelection("<p><strong>hello</strong> world</p>", 1, 11);
    expect(activeFormats(state).strong).toBe(true);
  });
});

describe("activeFormats — block types", () => {
  it("reports the heading level under the selection", () => {
    const state = stateWithSelection("<h2>Findings</h2><p>body</p>", 1, 5);
    expect(activeFormats(state).headingLevel).toBe(2);
  });

  it("reports null heading for a selection spanning a heading and a paragraph", () => {
    // <h2>Findings</h2> spans 0..10; the paragraph starts at 10.
    const state = stateWithSelection("<h2>Findings</h2><p>body</p>", 1, 13);
    expect(activeFormats(state).headingLevel).toBeNull();
  });

  it("reports the enclosing list kind", () => {
    const bullet = stateWithSelection("<ul><li><p>one</p></li></ul>", 3, 6);
    expect(activeFormats(bullet).listKind).toBe("bullet");

    const ordered = stateWithSelection("<ol><li><p>one</p></li></ol>", 3, 6);
    expect(activeFormats(ordered).listKind).toBe("ordered");
  });

  it("reports null list kind outside any list and across differing list kinds", () => {
    const outside = stateWithSelection("<p>hello world</p>", 1, 6);
    expect(activeFormats(outside).listKind).toBeNull();

    // Selection from inside the <ul> to inside the <ol>.
    const straddling = stateWithSelection(
      "<ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol>",
      3,
      12,
    );
    expect(activeFormats(straddling).listKind).toBeNull();
  });
});

describe("toggleFormatCommand", () => {
  it("bolds the selection and PRESERVES it, so a second toggle can chain without re-selecting", () => {
    const selected = stateWithSelection("<p>hello world</p>", 1, 6);

    let next = selected;
    const applied = toggleFormatCommand("strong")(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<p><strong>hello</strong> world</p>");
    // The selection survives the toggle — the chaining contract.
    expect(next.selection.from).toBe(1);
    expect(next.selection.to).toBe(6);
    expect(activeFormats(next).strong).toBe(true);

    // Chain italic on the SAME (preserved) selection.
    let chained = next;
    toggleFormatCommand("em")(next, (tr) => {
      chained = next.apply(tr);
    });
    expect(serializeBody(docJson(chained))).toBe("<p><em><strong>hello</strong></em> world</p>");
    expect(activeFormats(chained)).toMatchObject({ strong: true, em: true });
  });

  it("toggling an already-bold selection removes the mark", () => {
    const selected = stateWithSelection("<p><strong>hello</strong> world</p>", 1, 6);

    let next = selected;
    toggleFormatCommand("strong")(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(serializeBody(docJson(next))).toBe("<p>hello world</p>");
    expect(activeFormats(next).strong).toBe(false);
  });
});

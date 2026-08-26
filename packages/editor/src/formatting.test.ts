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
import {
  activeFormats,
  removeLinkCommand,
  setLinkCommand,
  toggleFormatCommand,
  validateLinkHref,
} from "./formatting";

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
      linkHref: null,
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

  it("carries the active link's href — the link editor's pre-fill (ticket #299)", () => {
    const range = stateWithSelection('<p><a href="https://example.com">hello</a> world</p>', 1, 6);
    expect(activeFormats(range).linkHref).toBe("https://example.com");

    // A cursor inside the link reads the same href.
    const cursor = stateWithSelection('<p><a href="https://example.com">hello</a> world</p>', 3);
    expect(activeFormats(cursor).linkHref).toBe("https://example.com");

    // No link touched → nothing to pre-fill.
    const plain = stateWithSelection("<p>hello world</p>", 1, 6);
    expect(activeFormats(plain).linkHref).toBeNull();
    expect(activeFormats(plain).link).toBe(false);
  });

  it("reports nothing active over plain text", () => {
    const state = stateWithSelection("<p>hello world</p>", 1, 6);
    expect(activeFormats(state)).toEqual({
      strong: false,
      em: false,
      link: false,
      linkHref: null,
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

describe("validateLinkHref", () => {
  it("accepts a normal https URL, trimming surrounding whitespace", () => {
    expect(validateLinkHref("  https://example.com/a?b=c  ")).toEqual({
      ok: true,
      href: "https://example.com/a?b=c",
    });
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(validateLinkHref("")).toEqual({ ok: false, reason: "empty" });
    expect(validateLinkHref("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects unsafe schemes with the SAME rule the schema enforces at parse/serialize time", () => {
    expect(validateLinkHref("javascript:alert(1)")).toEqual({ ok: false, reason: "unsafe" });
    // The classic filter bypass — control chars embedded in the scheme word —
    // must fail here exactly because `isDangerousUrl` (arp-report-html) is
    // the shared predicate, not a second regex grown in this package.
    expect(validateLinkHref("jav\tascript:alert(1)")).toEqual({ ok: false, reason: "unsafe" });
    expect(validateLinkHref("vbscript:msgbox(1)")).toEqual({ ok: false, reason: "unsafe" });
    expect(validateLinkHref("data:text/html,<script>1</script>")).toEqual({
      ok: false,
      reason: "unsafe",
    });
  });

  it("accepts relative, anchor and mailto URLs — everything the schema itself retains", () => {
    expect(validateLinkHref("/reports/latest")).toEqual({ ok: true, href: "/reports/latest" });
    expect(validateLinkHref("#section-two")).toEqual({ ok: true, href: "#section-two" });
    expect(validateLinkHref("mailto:a@b.com")).toEqual({ ok: true, href: "mailto:a@b.com" });
  });
});

describe("setLinkCommand", () => {
  it("links the selection and PRESERVES it, with the active state reading link + href", () => {
    const selected = stateWithSelection("<p>hello world</p>", 1, 6);

    let next = selected;
    const applied = setLinkCommand("https://example.com")(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe(
      '<p><a href="https://example.com">hello</a> world</p>',
    );
    // The selection survives (same chaining contract as the mark toggles) —
    // what keeps the toolbar up and its Link button lit after the apply.
    expect(next.selection.from).toBe(1);
    expect(next.selection.to).toBe(6);
    expect(activeFormats(next)).toMatchObject({ link: true, linkHref: "https://example.com" });
  });

  it("REFUSES an unsafe href without dispatching — the document is untouched", () => {
    const selected = stateWithSelection("<p>hello world</p>", 1, 6);

    let dispatched = false;
    const applied = setLinkCommand("javascript:alert(1)")(selected, () => {
      dispatched = true;
    });

    expect(applied).toBe(false);
    expect(dispatched).toBe(false);
  });

  it("refuses a collapsed selection outside any link — there is nothing to wrap", () => {
    const cursor = stateWithSelection("<p>hello world</p>", 3);
    expect(setLinkCommand("https://example.com")(cursor, () => {})).toBe(false);
  });

  it("edits the WHOLE existing link from a cursor inside it — no split, one href", () => {
    const cursor = stateWithSelection('<p><a href="https://old.example">hello</a> world</p>', 3);

    let next = cursor;
    const applied = setLinkCommand("https://new.example")(cursor, (tr) => {
      next = cursor.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe(
      '<p><a href="https://new.example">hello</a> world</p>',
    );
  });

  it("a selection covering PART of a link re-links the link's full extent — editing never splits", () => {
    // Select "hel" (1..4) of the linked "hello": the new href must cover all
    // of "hello", not fracture it into two adjacent links.
    const partial = stateWithSelection(
      '<p><a href="https://old.example">hello</a> world</p>',
      1,
      4,
    );

    let next = partial;
    setLinkCommand("https://new.example")(partial, (tr) => {
      next = partial.apply(tr);
    });

    expect(serializeBody(docJson(next))).toBe(
      '<p><a href="https://new.example">hello</a> world</p>',
    );
  });
});

describe("removeLinkCommand", () => {
  it("removes the whole link from a cursor inside it", () => {
    const cursor = stateWithSelection('<p><a href="https://example.com">hello</a> world</p>', 3);

    let next = cursor;
    const applied = removeLinkCommand()(cursor, (tr) => {
      next = cursor.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<p>hello world</p>");
    expect(activeFormats(next).link).toBe(false);
  });

  it("removes across a selected range and returns false when no link is touched", () => {
    const range = stateWithSelection('<p><a href="https://example.com">hello</a> world</p>', 1, 6);
    let next = range;
    expect(
      removeLinkCommand()(range, (tr) => {
        next = range.apply(tr);
      }),
    ).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<p>hello world</p>");

    const plain = stateWithSelection("<p>hello world</p>", 1, 6);
    expect(removeLinkCommand()(plain, () => {})).toBe(false);
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

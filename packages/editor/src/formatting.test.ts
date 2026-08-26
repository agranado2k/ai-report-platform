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
  toggleHeadingCommand,
  toggleListCommand,
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

  it("a range spanning TWO links reads the FIRST href — the documented multi-link convention", () => {
    // "one" is linked to a.example, "two" (adjacent) to b.example; the
    // selection covers both. The pre-fill convention is first-occurrence-wins
    // (activeLinkHref's doc comment) — a last-wins traversal would silently
    // pre-fill the wrong link's href.
    const spanning = stateWithSelection(
      '<p><a href="https://a.example">one</a><a href="https://b.example">two</a></p>',
      1,
      7,
    );
    expect(activeFormats(spanning).linkHref).toBe("https://a.example");
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

  it("rejects entity-encoded schemes the browser would decode in the served href (PR #303 C-1)", () => {
    // This ingress validates a RAW typed string, and serializeBody writes it
    // into the served document with no re-parse — so a scheme obfuscated with
    // HTML character references must be rejected here, or it ships live. Same
    // shared predicate (isDangerousUrl), now decode-aware.
    for (const encoded of [
      "javascript&colon;alert(1)",
      "&#106;avascript:alert(1)",
      "&#x6a;avascript:alert(1)",
      "java&Tab;script:alert(1)",
    ]) {
      expect(validateLinkHref(encoded), encoded).toEqual({ ok: false, reason: "unsafe" });
    }
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

  it("a caret at the link's TRAILING boundary still edits the whole link", () => {
    // <p><a…>hello</a> world</p>: "hello" spans 1..6, so 6 is the boundary
    // BETWEEN the link and the plain text. childAfter there reads the
    // unmarked " world" run — markExtent's childBefore fallback is what makes
    // the caret still belong to the link; without it this caret would be
    // "outside any link" and the edit would refuse.
    const trailing = stateWithSelection('<p><a href="https://old.example">hello</a> world</p>', 6);

    let next = trailing;
    const applied = setLinkCommand("https://new.example")(trailing, (tr) => {
      next = trailing.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe(
      '<p><a href="https://new.example">hello</a> world</p>',
    );
  });

  it("editing one of two ADJACENT links never bleeds into its neighbor", () => {
    // Two links touch with no text between them. The extent walk compares
    // MARK INSTANCES (mark.isInSet), not mark types — a type-level walk would
    // read both runs as one link and rewrite them both.
    const cursor = stateWithSelection(
      '<p><a href="https://a.example">one</a><a href="https://b.example">two</a></p>',
      2,
    );

    let next = cursor;
    const applied = setLinkCommand("https://new.example")(cursor, (tr) => {
      next = cursor.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe(
      '<p><a href="https://new.example">one</a><a href="https://b.example">two</a></p>',
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

  it("a caret at the link's TRAILING boundary still removes the whole link", () => {
    // Same childBefore-fallback contract as the setLink twin above: pos 6 is
    // the boundary between the linked "hello" and the plain " world".
    const trailing = stateWithSelection('<p><a href="https://example.com">hello</a> world</p>', 6);

    let next = trailing;
    const applied = removeLinkCommand()(trailing, (tr) => {
      next = trailing.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<p>hello world</p>");
  });

  it("removing one of two ADJACENT links leaves the other intact", () => {
    // Cursor in the SECOND link: the extent's backward walk must stop at the
    // instance boundary (mark.isInSet), or removing b.example's link would
    // strip a.example's too.
    const cursor = stateWithSelection(
      '<p><a href="https://a.example">one</a><a href="https://b.example">two</a></p>',
      5,
    );

    let next = cursor;
    const applied = removeLinkCommand()(cursor, (tr) => {
      next = cursor.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe('<p><a href="https://a.example">one</a>two</p>');
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

describe("toggleHeadingCommand", () => {
  it("converts a paragraph to the heading and PRESERVES the selection, with the level reading active", () => {
    const selected = stateWithSelection("<p>hello world</p>", 1, 6);

    let next = selected;
    const applied = toggleHeadingCommand(2)(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<h2>hello world</h2>");
    // The selection survives (the chaining contract shared with the mark
    // toggles) — what keeps the toolbar up with its H2 button lit.
    expect(next.selection.from).toBe(1);
    expect(next.selection.to).toBe(6);
    expect(activeFormats(next).headingLevel).toBe(2);
  });

  it("toggling the ACTIVE level returns the block to a paragraph", () => {
    const selected = stateWithSelection("<h2>hello world</h2>", 1, 6);

    let next = selected;
    const applied = toggleHeadingCommand(2)(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<p>hello world</p>");
    expect(activeFormats(next).headingLevel).toBeNull();
  });

  it("a DIFFERENT level converts the heading rather than toggling to paragraph", () => {
    const selected = stateWithSelection("<h3>hello world</h3>", 1, 6);

    let next = selected;
    toggleHeadingCommand(2)(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(serializeBody(docJson(next))).toBe("<h2>hello world</h2>");
    expect(activeFormats(next).headingLevel).toBe(2);
  });

  it("retained id/class/style SURVIVE the conversion in both directions — anchors must not die", () => {
    // Heading → paragraph: `level` (heading-only) drops; id/class/style stay.
    const heading = stateWithSelection(
      '<h2 id="summary" class="fancy" style="color: red">Findings</h2>',
      1,
      5,
    );
    let asParagraph = heading;
    toggleHeadingCommand(2)(heading, (tr) => {
      asParagraph = heading.apply(tr);
    });
    expect(serializeBody(docJson(asParagraph))).toBe(
      '<p id="summary" style="color: red" class="fancy">Findings</p>',
    );

    // Paragraph → heading: same retention the other way.
    const paragraph = stateWithSelection('<p id="intro" class="fancy">Findings</p>', 1, 5);
    let asHeading = paragraph;
    toggleHeadingCommand(3)(paragraph, (tr) => {
      asHeading = paragraph.apply(tr);
    });
    expect(serializeBody(docJson(asHeading))).toBe('<h3 id="intro" class="fancy">Findings</h3>');
  });

  it("a paragraph VARIANT class round-trips through a heading via the retained class attr", () => {
    // `<p class="sub">` parses to variant "sub" AND class "sub"; the heading
    // keeps `class` (variant is paragraph-only), and toggling back re-parses
    // nothing — the paragraph's toDOM emits `variant ?? class`, so the class
    // survives the full trip.
    const sub = stateWithSelection('<p class="sub">hello world</p>', 1, 6);
    let asHeading = sub;
    toggleHeadingCommand(2)(sub, (tr) => {
      asHeading = sub.apply(tr);
    });
    expect(serializeBody(docJson(asHeading))).toBe('<h2 class="sub">hello world</h2>');

    let back = asHeading;
    toggleHeadingCommand(2)(asHeading, (tr) => {
      back = asHeading.apply(tr);
    });
    expect(serializeBody(docJson(back))).toBe('<p class="sub">hello world</p>');
  });

  it("a MIXED selection (paragraph + heading) becomes uniformly the requested level", () => {
    // No uniform active level → the button means "make it all H2", never a
    // per-block flip that would invert the mix.
    const mixed = stateWithSelection("<p>one</p><h3>two</h3>", 1, 9);

    let next = mixed;
    const applied = toggleHeadingCommand(2)(mixed, (tr) => {
      next = mixed.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<h2>one</h2><h2>two</h2>");
    expect(activeFormats(next).headingLevel).toBe(2);
  });

  it("returns false (nothing dispatched) where the schema cannot hold a heading", () => {
    // A checklist item's content is inline-only and its parent only holds
    // checklist items — no textblock in range can become a heading.
    const checklist = stateWithSelection('<ul class="checklist"><li>item</li></ul>', 2, 5);
    let dispatched = false;
    expect(
      toggleHeadingCommand(2)(checklist, () => {
        dispatched = true;
      }),
    ).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe("toggleListCommand", () => {
  it("wraps the selection's paragraph in a bullet list, with the kind reading active", () => {
    const selected = stateWithSelection("<p>hello world</p>", 1, 6);

    let next = selected;
    const applied = toggleListCommand("bullet")(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<ul><li><p>hello world</p></li></ul>");
    expect(activeFormats(next).listKind).toBe("bullet");
  });

  it("wraps in an ordered list, distinguished from bullet by the active reading", () => {
    const selected = stateWithSelection("<p>hello world</p>", 1, 6);

    let next = selected;
    toggleListCommand("ordered")(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(serializeBody(docJson(next))).toBe("<ol><li><p>hello world</p></li></ol>");
    expect(activeFormats(next).listKind).toBe("ordered");
    expect(activeFormats(next).headingLevel).toBeNull();
  });

  it("toggling the ACTIVE kind lifts the item back out to a paragraph", () => {
    // <ul><li><p>one</p></li></ul>: "one" spans 3..6.
    const selected = stateWithSelection("<ul><li><p>one</p></li></ul>", 3, 6);

    let next = selected;
    const applied = toggleListCommand("bullet")(selected, (tr) => {
      next = selected.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<p>one</p>");
    expect(activeFormats(next).listKind).toBeNull();
  });

  it("lifting from a NESTED list lifts exactly once — into the parent list, never exploding the stack", () => {
    // <ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>: cursor in "b" (8).
    // The nearest enclosing list is the inner bullet, so toggling bullet
    // lifts item b ONE level, making it a sibling item of the outer list.
    const nested = stateWithSelection("<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>", 8);

    let next = nested;
    const applied = toggleListCommand("bullet")(nested, (tr) => {
      next = nested.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    // Still a bullet list — one more press would lift the rest of the way.
    expect(activeFormats(next).listKind).toBe("bullet");
  });

  it("the OTHER kind at the top of an existing list REFUSES — wrapInList's own semantics, document untouched", () => {
    // Cursor in the FIRST item of a bullet list: prosemirror-schema-list's
    // wrapInList declines to nest a sublist there ("don't do anything at the
    // top of the list"), and this module deliberately does not grow a
    // convert-in-place transform on top of it.
    const first = stateWithSelection("<ul><li><p>one</p></li></ul>", 3, 6);
    let dispatched = false;
    expect(
      toggleListCommand("ordered")(first, () => {
        dispatched = true;
      }),
    ).toBe(false);
    expect(dispatched).toBe(false);
  });

  it("the OTHER kind on a LATER item nests a sublist of that kind under the previous item", () => {
    // <ul><li><p>one</p></li><li><p>two</p></li></ul>: cursor in "two" (11).
    const later = stateWithSelection("<ul><li><p>one</p></li><li><p>two</p></li></ul>", 11);

    let next = later;
    const applied = toggleListCommand("ordered")(later, (tr) => {
      next = later.apply(tr);
    });

    expect(applied).toBe(true);
    expect(serializeBody(docJson(next))).toBe(
      "<ul><li><p>one</p><ol><li><p>two</p></li></ol></li></ul>",
    );
    // Nearest-enclosing wins: the caret now types into the ordered sublist.
    expect(activeFormats(next).listKind).toBe("ordered");
  });

  it("wrapping PRESERVES a usable selection — the toolbar's chaining contract", () => {
    const selected = stateWithSelection("<p>hello world</p>", 1, 6);

    let next = selected;
    toggleListCommand("bullet")(selected, (tr) => {
      next = selected.apply(tr);
    });

    // The mapped selection still covers the same text inside the new list.
    const { from, to } = next.selection;
    expect(next.doc.textBetween(from, to)).toBe("hello");
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

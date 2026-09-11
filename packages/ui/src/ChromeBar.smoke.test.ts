import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChromeBar, chromeBarPillClass } from "./ChromeBar";

describe("ChromeBar", () => {
  it("puts the document's title over the product label, and fills both slots", () => {
    const html = r(
      h(
        ChromeBar,
        { docTitle: "Q3 roadmap review", pill: h("span", {}, "Private") },
        h("a", { href: "/x/edit" }, "Edit"),
      ),
    );
    expect(html).toContain("Q3 roadmap review");
    expect(html).toContain("Centaur Spec");
    expect(html).toContain("Private");
    expect(html).toContain("Edit");
  });
  it("renders an author-controlled docTitle as text, never as markup", () => {
    // Callers pass report titles through here and report titles are written by
    // whoever published the report — the one untrusted string on an otherwise
    // first-party page (ADR-0089 §6).
    const html = r(h(ChromeBar, { docTitle: '<img src=x onerror="alert(1)">' }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
  it("hides itself in print — a printed report keeps the document, never the chrome", () => {
    expect(r(h(ChromeBar, { docTitle: "x" }))).toContain("print:hidden");
  });
  it("is one strip: the brand mark is decorative, so the title is the only h1", () => {
    // The monogram sits beside the product name as text, so announcing it would
    // be a duplicate — the reason it carries aria-hidden rather than a label.
    const html = r(h(ChromeBar, { docTitle: "x" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
  it("a filled pill wears the chip; an unfilled one is bare text", () => {
    // The two branches are a real distinction, not styling trivia: the chip
    // shape says "this pill is carrying a message". A save-status pill that
    // holds its slot while empty must not draw an empty chip.
    expect(chromeBarPillClass(true)).toContain("rounded-full");
    expect(chromeBarPillClass(true)).toContain("bg-hover");
    expect(chromeBarPillClass(false)).not.toContain("rounded-full");
    expect(chromeBarPillClass(false)).not.toContain("bg-hover");
  });
  it("both pill variants keep the strip's own type scale, so the slot never reflows", () => {
    for (const filled of [true, false]) {
      expect(chromeBarPillClass(filled)).toContain("inline-flex");
      expect(chromeBarPillClass(filled)).toContain("text-xs");
    }
  });
});

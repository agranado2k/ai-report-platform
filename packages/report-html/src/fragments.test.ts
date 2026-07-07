import { describe, expect, it } from "vitest";
import { parseBody, serializeBody } from "./body.js";

describe("fragment-level round-trips", () => {
  it("round-trips a bare paragraph", () => {
    const html = "<p>Hello world</p>";
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips the chip mark for every variant in the enum", () => {
    // Wrapped in a real <p> (rather than a bare block container) so this
    // test isolates the chip mark itself from the auto-<p>-wrap invariant
    // (ADR-0062 §7), which is pinned separately in auto-wrap.test.ts.
    const html =
      "<p>" +
      '<span class="chip chip-cto">CTO</span>' +
      '<span class="chip chip-staff">Staff Engineer</span>' +
      '<span class="chip chip-pm">Product Manager</span>' +
      '<span class="chip chip-now">Now</span>' +
      '<span class="chip chip-1yr">1 yr</span>' +
      '<span class="chip chip-5yr">5 yr</span>' +
      '<span class="chip chip-have">Have</span>' +
      '<span class="chip chip-sharpen">Sharpen</span>' +
      '<span class="chip chip-build">Build</span>' +
      "</p>";
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips the pill mark", () => {
    const html = '<p><span class="pill">Evals discipline</span></p>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips the kbd mark", () => {
    const html = '<p><span class="kbd">2 Aug 2026</span></p>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips strong/em/a, including an inline style on strong", () => {
    const html =
      '<p>Built for <strong>Arthur Granado</strong> — Founder &amp; CTO of ' +
      '<a href="https://uk.linkedin.com/in/agranado2k">House Numbers</a>, ex-Snyk. ' +
      'Horizons: <strong style="color:var(--now)">now</strong>, <em>next 12 months</em>.</p>';
    // jsdom (like a real browser) re-serializes the `style` attribute from
    // the parsed CSSStyleDeclaration, not the original attribute text — it
    // normalizes to `color: var(--now);` (space after colon, trailing
    // semicolon). This is DOM CSSOM behavior, not a schema fidelity loss
    // (the class/tag/text-fidelity contract this package targets, per
    // ADR-0062 §3, never claimed byte-identical `style` attribute text).
    const expected = html.replace('style="color:var(--now)"', 'style="color: var(--now);"');
    expect(serializeBody(parseBody(html))).toBe(expected);
  });

  it("preserves an unrecognized class on a generic inline <span> (attr-retention rule)", () => {
    const html = '<p>before <span class="future-thing">middle</span> after</p>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("preserves an unrecognized class on a generic block <div> (attr-retention rule)", () => {
    const html = '<div class="future-thing"><p>content</p></div>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips p.desc, a paragraph role distinct from a bare <p>", () => {
    const html = '<p class="desc">In the AI age the CTO is judged on three calls per year.</p>';
    expect(serializeBody(parseBody(html))).toBe(html);

    // "Paragraph role distinct from a bare <p>" (ADR-0062 §3) means desc is
    // recognized as first-class schema vocabulary via a `variant` attr, not
    // merely round-tripped as an opaque, unrecognized `class` string
    // indistinguishable from e.g. `<p class="future-thing">`.
    const doc = parseBody(html) as { content: [{ attrs: { variant: string | null } }] };
    expect(doc.content[0].attrs.variant).toBe("desc");
  });

  it("round-trips p.lede", () => {
    const html = '<p class="lede">Every recommendation is tagged so you can triage in seconds.</p>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips p.sub", () => {
    const html = '<p class="sub">Built for <strong>Arthur Granado</strong>.</p>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips sec/secnum — a section heading carrying the numbered label as an attribute", () => {
    const html = '<h2 class="sec"><span class="secnum">1</span>Executive summary</h2>';
    expect(serializeBody(parseBody(html))).toBe(html);

    // secnum is a node attribute (ADR-0062 §3), not indistinguishable
    // inline content — addressable for e.g. a future "renumber" feature.
    const doc = parseBody(html) as { content: [{ type: string; attrs: { secnum: string } }] };
    expect(doc.content[0].type).toBe("sec");
    expect(doc.content[0].attrs.secnum).toBe("1");
  });

  it("round-trips section, retaining its id (anchor target for the sidebar TOC)", () => {
    const html = '<section id="summary"><p>Body text.</p></section>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips card", () => {
    const html = '<div class="card"><h4>Title</h4><p class="desc">Body text.</p></div>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips a card with multiple co-occurring classes (e.g. pillar variants)", () => {
    const html = '<div class="card pillar pillar-A"><p class="desc">Text.</p></div>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips checklist, holding bare inline content per <li> (no auto-wrap — it's a list item)", () => {
    const html =
      '<ul class="checklist"><li>Chip Huyen · <em>AI Engineering</em></li>' +
      "<li>Will Larson · <em>Crafting Engineering Strategy</em></li></ul>";
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips grid with a g3 column variant", () => {
    const html =
      '<div class="grid g3"><div class="card"><p>A</p></div><div class="card"><p>B</p></div></div>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips grid with a g2 column variant", () => {
    const html =
      '<div class="grid g2"><div class="card"><p>A</p></div><div class="card"><p>B</p></div></div>';
    expect(serializeBody(parseBody(html))).toBe(html);
  });

  it("round-trips a generic bullet list (e.g. .baseline, .toc, .reflist — no dedicated node)", () => {
    // list_item's content model (inherited from prosemirror-schema-list,
    // same as `paragraph block*`) wraps bare inline content in a <p>, same
    // as the generic block catch-all (ADR-0062 §7) — pinned here rather
    // than in auto-wrap.test.ts since it's specific to how list items work.
    const html = '<ul class="baseline"><li><span class="k">Role:</span> Founder</li></ul>';
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).toBe(
      '<ul class="baseline"><li><p><span class="k">Role:</span> Founder</p></li></ul>',
    );
  });
});

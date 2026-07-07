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
});

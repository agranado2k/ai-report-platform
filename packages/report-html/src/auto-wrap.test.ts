import { describe, expect, it } from "vitest";
import { parseBody, serializeBody } from "./body.js";

/**
 * ADR-0062 §7 accepted cost, pinned as a contract: ProseMirror auto-wraps
 * bare inline content in a <p> inside block containers whose content model
 * is `block*` (the generic attr-retention catch-all, and every other
 * container built on it). This is "worked with, not fought" — the fixture
 * itself has many such containers (e.g. `.chips`, `.rtags` clusters of bare
 * chip spans, or a `.card` holding bare text), and normalizing
 * report-generator output to avoid this is out of scope for this package.
 */
describe("auto-<p>-wrap invariant (ADR-0062 §7)", () => {
  it("wraps bare inline chip spans directly inside a generic block in a <p>", () => {
    const html =
      '<div class="chips">' +
      '<span class="chip chip-cto">CTO</span>' +
      '<span class="chip chip-staff">Staff Engineer</span>' +
      "</div>";
    const roundtripped = serializeBody(parseBody(html));

    expect(roundtripped).toBe(
      '<div class="chips"><p>' +
        '<span class="chip chip-cto">CTO</span>' +
        '<span class="chip chip-staff">Staff Engineer</span>' +
        "</p></div>",
    );
  });

  it("wraps bare inline text + strong directly inside a .card in a <p>, without losing the text", () => {
    const html =
      '<div class="card"><strong>Don\'t pretrain a foundation model.</strong> Read about it.</div>';
    const roundtripped = serializeBody(parseBody(html));

    expect(roundtripped).toBe(
      '<div class="card"><p><strong>Don\'t pretrain a foundation model.</strong> Read about it.</p></div>',
    );
  });
});

import { describe, expect, it } from "vitest";
import { parseBody, serializeBody } from "../body.js";

/**
 * Fix 3 (editor styling pass): `rt`/`rd`/`rtags`/`chips`/`block-label` get
 * dedicated `content: 'inline*'` node specs (schema/inline-content.ts) so
 * their bare inline content round-trips WITHOUT ProseMirror auto-wrapping it
 * in a `<p>` — unlike the generic attr-retention catch-all's `block*`
 * containers (still pinned in auto-wrap.test.ts for `.card`/anything else on
 * the catch-all).
 */
describe("inline-content nodes (rt/rd/rtags/chips/block-label) — no auto-<p>-wrap", () => {
  it.each([
    ["rt", '<div class="rt">Title</div>'],
    ["rd", '<div class="rd">A description sentence.</div>'],
    ["block-label", '<div class="block-label">Read</div>'],
  ])("round-trips bare text in .%s without introducing a <p>", (_name, html) => {
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).toBe(html);
    expect(roundtripped).not.toContain("<p>");
  });

  it("round-trips .rtags holding bare chip spans without introducing a <p>", () => {
    const html =
      '<div class="rtags">' +
      '<span class="chip chip-cto">CTO</span>' +
      '<span class="chip chip-staff">Staff</span>' +
      "</div>";
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).toBe(html);
    expect(roundtripped).not.toContain("<p>");
  });

  it("round-trips .chips holding bare chip spans without introducing a <p>", () => {
    const html =
      '<div class="chips">' +
      '<span class="chip chip-cto">CTO</span>' +
      '<span class="chip chip-staff">Staff Engineer</span>' +
      "</div>";
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).toBe(html);
    expect(roundtripped).not.toContain("<p>");
  });

  it("preserves inline marks (em/strong) inside .rd", () => {
    const html = '<div class="rd">Read <em>this</em> chapter first.</div>';
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).toBe(html);
  });

  it("preserves an inline .ref span inside .rt alongside text", () => {
    const html = '<div class="rt">See <span class="ref">github.com/x</span></div>';
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).toBe(html);
  });

  it("still parses a real resrow's rt/rmeta/rd/rtags cluster without throwing", () => {
    const html =
      '<div class="resrow">' +
      "<div>" +
      '<div class="rt">AI Engineering</div>' +
      '<div class="rmeta">Chip Huyen · O\'Reilly</div>' +
      '<div class="rd">Best inventory of the stack.</div>' +
      "</div>" +
      '<div class="rtags"><span class="chip chip-cto">CTO</span></div>' +
      "</div>";
    const roundtripped = serializeBody(parseBody(html));
    expect(roundtripped).toContain('<div class="rt">AI Engineering</div>');
    expect(roundtripped).toContain(
      '<div class="rtags"><span class="chip chip-cto">CTO</span></div>',
    );
    // rmeta is still on the generic catch-all (out of scope for this pass) —
    // its bare inline text is still auto-wrapped in a <p>.
    expect(roundtripped).toContain('<div class="rmeta"><p>');
  });
});

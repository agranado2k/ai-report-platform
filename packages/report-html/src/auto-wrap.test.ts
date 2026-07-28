import { describe, expect, it } from "vitest";
import { parseBody, serializeBody } from "./body.js";

/**
 * ADR-0062 §7 accepted cost, pinned as a contract: ProseMirror auto-wraps
 * bare inline content in a <p> inside block containers whose content model
 * is `block*` (the generic attr-retention catch-all, and every other
 * container built on it that hasn't been given a dedicated `inline*` spec).
 * This is "worked with, not fought" for containers that legitimately mix
 * inline and block content (e.g. a `.card` holding bare text next to other
 * blocks) — normalizing report-generator output to avoid it is out of scope
 * for this package.
 *
 * `.chips`/`.rtags` (and `rt`/`rd`/`block-label`) are NO LONGER on this
 * catch-all path (editor styling/structure fix, Fix 3) — they now have
 * dedicated `content: 'inline*'` specs (schema/inline-content.ts) precisely
 * because they never held anything but bare inline content, so the <p>
 * auto-wrap was pure noise there. See schema/inline-content.test.ts for
 * their no-<p> contract; kept here is only the remaining case (`.card`) that
 * genuinely still goes through the generic `block*` catch-all.
 */
describe("auto-<p>-wrap invariant (ADR-0062 §7)", () => {
  it("wraps bare inline text + strong directly inside a .card in a <p>, without losing the text", () => {
    const html =
      '<div class="card"><strong>Don\'t pretrain a foundation model.</strong> Read about it.</div>';
    const roundtripped = serializeBody(parseBody(html));

    expect(roundtripped).toBe(
      '<div class="card"><p><strong>Don\'t pretrain a foundation model.</strong> Read about it.</p></div>',
    );
  });
});

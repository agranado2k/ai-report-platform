// diffHtmlFallback (ADR-0065 §3) — the best-effort DOM/text-level diff used
// when either side of a version comparison lacks a `_source.json` sidecar
// (most commonly an externally-uploaded version never opened in the
// editor). Deliberately lower-fidelity than diffRendered's word-level
// structural diff: block-level compare only. The UI must always show
// `label` alongside the output so the lower fidelity is never mistaken for
// the structured diff (ADR-0065 §3's explicit requirement).
import { describe, expect, it } from "vitest";
import {
  diffHtmlFallback,
  FALLBACK_DEL_CLASS,
  FALLBACK_INS_CLASS,
  STRUCTURAL_DIFF_UNAVAILABLE_LABEL,
} from "./html-fallback.js";

describe("diffHtmlFallback", () => {
  it("always carries the required lower-fidelity label", () => {
    const result = diffHtmlFallback("<p>a</p>", "<p>b</p>");
    expect(result.label).toBe(STRUCTURAL_DIFF_UNAVAILABLE_LABEL);
    expect(result.label).toContain("structural diff unavailable");
  });

  it("marks a changed block as both deleted (old) and inserted (new)", () => {
    const result = diffHtmlFallback(
      "<p>Original paragraph text.</p>",
      "<p>Edited paragraph text.</p>",
    );
    expect(result.html).toContain(FALLBACK_DEL_CLASS);
    expect(result.html).toContain(FALLBACK_INS_CLASS);
    expect(result.html).toContain("Original paragraph text.");
    expect(result.html).toContain("Edited paragraph text.");
  });

  it("leaves unchanged blocks unmarked", () => {
    const html = "<p>First unchanged block.</p><p>Second unchanged block.</p>";
    const result = diffHtmlFallback(html, html);
    expect(result.html).not.toContain(FALLBACK_INS_CLASS);
    expect(result.html).not.toContain(FALLBACK_DEL_CLASS);
    expect(result.html).toContain("First unchanged block.");
    expect(result.html).toContain("Second unchanged block.");
  });

  it("marks only the added block when a block is appended", () => {
    const oldHtml = "<p>Block one.</p>";
    const newHtml = "<p>Block one.</p><p>Block two, brand new.</p>";
    const result = diffHtmlFallback(oldHtml, newHtml);

    expect(result.html).not.toContain(FALLBACK_DEL_CLASS);
    expect(result.html).toContain(FALLBACK_INS_CLASS);
    expect(result.html).toContain("Block two, brand new.");
  });

  it("marks only the removed block when a block is deleted", () => {
    const oldHtml = "<p>Block one.</p><p>Block two, going away.</p>";
    const newHtml = "<p>Block one.</p>";
    const result = diffHtmlFallback(oldHtml, newHtml);

    expect(result.html).not.toContain(FALLBACK_INS_CLASS);
    expect(result.html).toContain(FALLBACK_DEL_CLASS);
    expect(result.html).toContain("Block two, going away.");
  });

  describe("SECURITY: this fallback runs on raw, unsanitized uploaded HTML (no reportSchema pass)", () => {
    it("never carries a live <script> tag through into the output", () => {
      const result = diffHtmlFallback(
        "<p>before</p>",
        "<p>before</p><script>alert(document.cookie)</script><p>after</p>",
      );
      expect(result.html.toLowerCase()).not.toContain("<script");
    });

    it("never carries an event-handler attribute through into the output", () => {
      const result = diffHtmlFallback("<p>old</p>", '<p onclick="steal()">new and dangerous</p>');
      expect(result.html.toLowerCase()).not.toMatch(/\son[a-z]+\s*=/);
      expect(result.html).toContain("new and dangerous");
    });

    it("HTML-escapes text that itself looks like markup, rather than re-parsing it", () => {
      const result = diffHtmlFallback("<p>old</p>", "<p>&lt;img src=x onerror=alert(1)&gt;</p>");
      // Whatever the entity round-trips to as text, it must never come out as
      // a live "<img" tag — the text mentioning "onerror=" is inert content
      // once it's not inside a real "<...>" tag.
      expect(result.html).not.toContain("<img");
    });
  });
});

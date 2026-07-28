// Behavior tests for buildSelectionAnchor — the client-side capture of an
// ADR-0064 §2a Anchor from the editor's current text selection ("select text,
// click Comment"). Pure/headless: no ProseMirror state needed, just the
// from/to/text/versionId a caller already has in hand.
import { describe, expect, it } from "vitest";
import { buildSelectionAnchor } from "./anchor";

describe("buildSelectionAnchor", () => {
  it("carries versionId and the selection's from/to through unchanged", () => {
    const anchor = buildSelectionAnchor({
      versionId: "version_abc123",
      from: 4,
      to: 12,
      text: "hello world",
    });
    expect(anchor.versionId).toBe("version_abc123");
    expect(anchor.relative).toEqual({ from: 4, to: 12 });
  });

  it("trims surrounding whitespace from the selected text", () => {
    const anchor = buildSelectionAnchor({
      versionId: "version_abc123",
      from: 0,
      to: 20,
      text: "  padded text  ",
    });
    expect(anchor.textQuote).toBe("padded text");
  });

  it("truncates a text quote longer than the domain's 2000-char cap", () => {
    const longText = "x".repeat(2500);
    const anchor = buildSelectionAnchor({
      versionId: "version_abc123",
      from: 0,
      to: 2500,
      text: longText,
    });
    expect(anchor.textQuote).toHaveLength(2000);
    expect(anchor.textQuote).toBe("x".repeat(2000));
  });

  it("does not truncate a text quote exactly at the 2000-char cap", () => {
    const exactText = "y".repeat(2000);
    const anchor = buildSelectionAnchor({
      versionId: "version_abc123",
      from: 0,
      to: 2000,
      text: exactText,
    });
    expect(anchor.textQuote).toHaveLength(2000);
  });
});

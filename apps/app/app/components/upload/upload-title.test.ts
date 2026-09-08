// Pure-logic tests for the upload screen's "title defaults to the document's own
// <title>" behavior (#337, report Z0W60dI8hu §03). Kept pure so it can drive BOTH
// the client prefill (fill the Title field when a file is dropped/pasted) and the
// server fallback (the action derives it when the field is left blank, so the
// default still works with JS off) — no DOM parser, so it runs in the node tier.
import { describe, expect, it } from "vitest";
import { deriveTitleFromHtml } from "./upload-title";

describe("deriveTitleFromHtml", () => {
  it("returns the text of the first <title> element", () => {
    expect(deriveTitleFromHtml("<html><head><title>Q3 Plan</title></head></html>")).toBe("Q3 Plan");
  });

  it("is case-insensitive on the tag name", () => {
    expect(deriveTitleFromHtml("<TITLE>Shouty</TITLE>")).toBe("Shouty");
  });

  it("ignores attributes on the opening tag", () => {
    expect(deriveTitleFromHtml('<title lang="en" data-x="1">Doc</title>')).toBe("Doc");
  });

  it("trims and collapses interior whitespace and newlines", () => {
    expect(deriveTitleFromHtml("<title>  Q3\n   Plan  </title>")).toBe("Q3 Plan");
  });

  it("decodes the common named and numeric HTML entities", () => {
    expect(deriveTitleFromHtml("<title>Sales &amp; Ops &lt;2026&gt;</title>")).toBe(
      "Sales & Ops <2026>",
    );
    expect(deriveTitleFromHtml("<title>Bob&#39;s &quot;deck&quot;</title>")).toBe('Bob\'s "deck"');
    expect(deriveTitleFromHtml("<title>caf&#xe9;</title>")).toBe("café");
  });

  it("takes the FIRST title when several are present", () => {
    expect(deriveTitleFromHtml("<title>First</title><title>Second</title>")).toBe("First");
  });

  it("returns undefined when there is no title element", () => {
    expect(deriveTitleFromHtml("<h1>Hello</h1><p>no title here</p>")).toBeUndefined();
  });

  it("returns undefined for an empty or whitespace-only title", () => {
    expect(deriveTitleFromHtml("<title></title>")).toBeUndefined();
    expect(deriveTitleFromHtml("<title>   \n  </title>")).toBeUndefined();
  });

  it("returns undefined for input with no HTML at all", () => {
    expect(deriveTitleFromHtml("")).toBeUndefined();
    expect(deriveTitleFromHtml("just some plain text")).toBeUndefined();
  });
});

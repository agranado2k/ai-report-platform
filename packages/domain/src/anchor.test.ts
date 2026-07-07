import { describe, expect, it } from "vitest";
import type { Anchor } from "./anchor";
import { validateAnchor } from "./anchor";
import { versionId } from "./brand";

const version = versionId("00000000-0000-7000-8000-0000000000b1");

describe("validateAnchor", () => {
  it("accepts a version-pinned anchor with a non-empty text quote", () => {
    const anchor: Anchor = { versionPinned: { versionId: version, textQuote: "the Q3 number" } };
    const r = validateAnchor(anchor);
    expect(r.ok).toBe(true);
  });

  it("rejects an empty (or whitespace-only) text quote", () => {
    expect(validateAnchor({ versionPinned: { versionId: version, textQuote: "" } }).ok).toBe(false);
    expect(validateAnchor({ versionPinned: { versionId: version, textQuote: "   " } }).ok).toBe(
      false,
    );
  });

  it("rejects a text quote over the bounded length", () => {
    const r = validateAnchor({
      versionPinned: { versionId: version, textQuote: "x".repeat(2001) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("passes through an opaque `relative` payload unchanged", () => {
    const anchor: Anchor = {
      versionPinned: { versionId: version, textQuote: "hi" },
      relative: { anything: true },
    };
    const r = validateAnchor(anchor);
    expect(r.ok && r.value.relative).toEqual({ anything: true });
  });
});

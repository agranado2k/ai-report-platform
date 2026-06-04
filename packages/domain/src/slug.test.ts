import { describe, expect, it } from "vitest";
import { makeSlug } from "./slug";

describe("makeSlug", () => {
  it("accepts a 10-char URL-safe id", () => {
    const r = makeSlug("aB3_xy-Z90");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("aB3_xy-Z90");
  });

  it("rejects the wrong length", () => {
    expect(makeSlug("tooShort").ok).toBe(false);
    expect(makeSlug("waaaaytoolong123").ok).toBe(false);
  });

  it("rejects characters outside the nanoid alphabet", () => {
    const r = makeSlug("abc!234567");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("ValidationError");
      if (r.error.kind === "ValidationError") expect(r.error.field).toBe("slug");
    }
  });
});

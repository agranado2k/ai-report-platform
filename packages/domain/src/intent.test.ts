import { describe, expect, it } from "vitest";
import { COMMENT_INTENTS, DEFAULT_INTENT, intentOrDefault, makeIntent } from "./intent";

describe("makeIntent", () => {
  it("accepts every member of the closed union", () => {
    for (const value of COMMENT_INTENTS) {
      const r = makeIntent(value);
      expect(r.ok && r.value).toBe(value);
    }
  });

  it("defaults an absent intent to note", () => {
    expect(makeIntent(undefined).ok && makeIntent(undefined)).toMatchObject({ value: "note" });
    expect(makeIntent(null)).toEqual({ ok: true, value: DEFAULT_INTENT });
  });

  it("rejects a present-but-invalid value with a ValidationError on `intent`", () => {
    const r = makeIntent("delete");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("ValidationError");
      expect(r.error.kind === "ValidationError" && r.error.field).toBe("intent");
    }
  });

  it("rejects a non-string value", () => {
    expect(makeIntent(42).ok).toBe(false);
    expect(makeIntent({}).ok).toBe(false);
  });
});

describe("intentOrDefault", () => {
  it("passes a valid intent through", () => {
    expect(intentOrDefault("enhancement")).toBe("enhancement");
  });

  it("degrades a missing/unknown stored value to note (legacy row)", () => {
    expect(intentOrDefault(undefined)).toBe("note");
    expect(intentOrDefault(null)).toBe("note");
    expect(intentOrDefault("garbage")).toBe("note");
  });
});

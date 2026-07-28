import { describe, expect, it } from "vitest";
import { err, ok } from "./result";

describe("Result", () => {
  it("ok carries a value on the ok discriminant", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err carries an error on the ok discriminant", () => {
    const r = err("boom");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("boom");
  });
});

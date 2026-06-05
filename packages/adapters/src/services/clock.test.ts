import { describe, expect, it } from "vitest";
import { SystemClock } from "./clock";

describe("SystemClock", () => {
  it("returns the current epoch in milliseconds", () => {
    const before = Date.now();
    const now = new SystemClock().now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

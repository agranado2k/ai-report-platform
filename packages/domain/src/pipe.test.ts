import { describe, expect, it } from "vitest";
import { pipe } from "./pipe";

describe("pipe", () => {
  it("returns the value unchanged with no functions", () => {
    expect(pipe(5)).toBe(5);
  });

  it("applies functions left to right", () => {
    const result = pipe(
      3,
      (n) => n + 1,
      (n) => n * 2,
      (n) => `=${n}`,
    );
    expect(result).toBe("=8");
  });
});

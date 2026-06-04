import { describe, expect, it } from "vitest";
import { err, flatMap, isErr, isOk, map, ok, unwrapOr } from "./result";

describe("Result", () => {
  it("ok carries a value and is recognised by isOk", () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err carries an error and is recognised by isErr", () => {
    const r = err("boom");
    expect(isErr(r)).toBe(true);
    if (!r.ok) expect(r.error).toBe("boom");
  });

  it("map transforms ok and passes err through", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err<string>("e"), (n: number) => n * 3)).toEqual(err("e"));
  });

  it("flatMap chains ok and short-circuits on err", () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err("odd"));
    expect(flatMap(ok(8), half)).toEqual(ok(4));
    expect(flatMap(ok(7), half)).toEqual(err("odd"));
    expect(flatMap(err<string>("first"), half)).toEqual(err("first"));
  });

  it("unwrapOr returns the value or the fallback", () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err<string>("e"), 9)).toBe(9);
  });
});

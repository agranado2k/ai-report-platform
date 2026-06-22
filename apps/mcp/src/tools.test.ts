import { describe, expect, it } from "vitest";
import { okResult, problemResult, toToolResult } from "./tools";

const textOf = (r: { content: readonly unknown[] }) => (r.content[0] as { text: string }).text;

describe("tool result mapping", () => {
  it("okResult returns pretty JSON text plus structuredContent for an object", () => {
    const r = okResult({ total: 3 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect(textOf(r)).toContain('"total": 3');
    expect(r.structuredContent).toEqual({ total: 3 });
  });

  it("okResult omits structuredContent for a non-object payload", () => {
    const r = okResult("plain");
    expect(r.structuredContent).toBeUndefined();
  });

  it("okResult omits structuredContent for an array payload (it's an object map, not a list)", () => {
    expect(okResult([1, 2, 3]).structuredContent).toBeUndefined();
  });

  it("okResult renders a friendly ack for a 204/no-content (undefined) result", () => {
    const r = okResult(undefined);
    expect(r.isError).toBeUndefined();
    expect((r.content[0] as { text: string }).text).toContain("OK");
    expect(r.structuredContent).toBeUndefined();
  });

  it("problemResult flags isError and renders status/code/detail", () => {
    const r = problemResult({
      title: "Unauthorized",
      status: 401,
      code: "unauthenticated",
      detail: "bad key",
    });
    expect(r.isError).toBe(true);
    const text = textOf(r);
    expect(text).toContain("401");
    expect(text).toContain("unauthenticated");
    expect(text).toContain("bad key");
  });

  it("toToolResult routes ok vs error", () => {
    expect(toToolResult({ ok: true, data: { x: 1 } }).isError).toBeUndefined();
    expect(toToolResult({ ok: false, problem: { title: "boom", status: 500 } }).isError).toBe(true);
  });
});

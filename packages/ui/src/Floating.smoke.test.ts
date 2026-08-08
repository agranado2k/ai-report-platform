// Smoke test for the Floating primitive (ticket #296) — the fixed-position
// surface the Selection toolbar floats on. Same node-only SSR pattern as
// Checkbox.smoke.test.ts. Position is inline style (numbers from the pure
// placement module), look is the Forge & Ember raised-surface treatment.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Floating } from "./Floating";

describe("Floating", () => {
  it("renders a fixed-position container at the given coordinates", () => {
    const html = renderToStaticMarkup(createElement(Floating, { left: 40, top: 120 }, "hi"));
    // Position must be INLINE style (the browser harness has no Tailwind, so
    // a class-based `fixed` would silently not position there).
    expect(html).toContain("position:fixed");
    expect(html).toContain("left:40px");
    expect(html).toContain("top:120px");
    expect(html).toContain("hi");
  });

  it("merges a caller className after the base classes", () => {
    const html = renderToStaticMarkup(
      createElement(Floating, { left: 0, top: 0, className: "p-1" }),
    );
    expect(html).toContain("bg-surface-raised");
    expect(html).toContain("p-1");
  });
});

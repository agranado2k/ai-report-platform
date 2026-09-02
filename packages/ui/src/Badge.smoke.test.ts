import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("a semantic tone pairs the soft fill with the AA text tier, not the base hue", () => {
    const html = r(h(Badge, { tone: "success" }, "Published"));
    expect(html).toContain("bg-success-soft");
    expect(html).toContain("text-success-fg");
    // the raw fill must NOT be used as the text colour (that was the AA bug)
    expect(html).not.toContain("text-success ");
  });
  it("dot renders a leading status dot in currentColor", () => {
    expect(r(h(Badge, { tone: "warning", dot: true }, "Processing"))).toContain("bg-current");
  });
  it("is a pill", () => {
    expect(r(h(Badge, {}, "x"))).toContain("rounded-full");
  });
});

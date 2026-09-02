import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("is an aside panel joined to the right edge by default", () => {
    const html = r(h(Sheet, {}, "panel"));
    expect(html).toMatch(/^<aside/);
    expect(html).toContain("w-96");
    expect(html).toContain("border-l");
  });
  it("side=left joins the left edge instead", () => {
    expect(r(h(Sheet, { side: "left" }, "x"))).toContain("border-r");
  });
});

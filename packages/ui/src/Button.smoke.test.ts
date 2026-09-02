import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, buttonClass } from "./Button";

describe("Button", () => {
  it("primary is a solid brand fill with on-brand text", () => {
    const html = r(h(Button, { variant: "primary" }, "Upload"));
    expect(html).toContain("bg-brand");
    expect(html).toContain("text-on-brand");
    expect(html).toContain('type="button"');
  });
  it("secondary is a tinted neutral fill, NOT a border", () => {
    const html = r(h(Button, { variant: "secondary" }, "x"));
    expect(html).toContain("bg-hover");
    expect(html).not.toContain("border-border");
  });
  it("outline is the only bordered variant and carries the xs shadow", () => {
    const html = r(h(Button, { variant: "outline" }, "x"));
    expect(html).toContain("border-border");
    expect(html).toContain("shadow-xs");
  });
  it("gradient uses the brand gradient token, not a flat colour", () => {
    expect(r(h(Button, { variant: "gradient" }, "x"))).toContain("var(--gradient-brand)");
  });
  it("loading disables, marks aria-busy, and renders a spinner", () => {
    const html = r(h(Button, { loading: true }, "Saving"));
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
  });
  it("iconOnly is square (size-*), not padded", () => {
    expect(r(h(Button, { iconOnly: true, size: "md" }))).toContain("size-9");
  });
  it("buttonClass returns the same look for link-as-button", () => {
    expect(buttonClass("primary", "lg")).toContain("bg-brand");
    expect(buttonClass("primary", "lg")).toContain("h-10");
  });
});

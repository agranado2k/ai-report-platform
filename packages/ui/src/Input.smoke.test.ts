import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input, Select, Textarea } from "./Input";

describe("Input", () => {
  it("rests on the neutral border with the placeholder tier", () => {
    const html = r(h(Input, { placeholder: "Search" }));
    expect(html).toContain("border-border");
    expect(html).toContain("placeholder:text-placeholder");
    expect(html).not.toContain("aria-invalid");
  });
  it("error swaps to the danger border and sets aria-invalid", () => {
    const html = r(h(Input, { error: true, defaultValue: "nope" }));
    expect(html).toContain("border-danger");
    expect(html).toContain('aria-invalid="true"');
  });
  it("size controls height (sm=h-8, md=h-9)", () => {
    expect(r(h(Input, { size: "sm" }))).toContain("h-8");
    expect(r(h(Input, { size: "md" }))).toContain("h-9");
  });
  it("Textarea and Select share the field look and take error", () => {
    expect(r(h(Textarea, { error: true }))).toContain("border-danger");
    expect(r(h(Select, {}, h("option", {}, "a")))).toContain("border-border");
  });
});

import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckIcon, SearchIcon } from "./icons";

describe("icons", () => {
  it("render inline SVG that inherits currentColor and is decorative", () => {
    const html = r(h(CheckIcon, {}));
    expect(html).toMatch(/^<svg/);
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('viewBox="0 0 24 24"');
  });
  it("size via className passthrough", () => {
    expect(r(h(SearchIcon, { className: "size-4" }))).toContain("size-4");
  });
});

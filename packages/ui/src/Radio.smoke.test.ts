import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Radio } from "./Radio";

describe("Radio", () => {
  it("renders a native radio, tinted, with name/value passthrough", () => {
    const html = r(h(Radio, { name: "dir", value: "asc" }));
    expect(html).toContain('type="radio"');
    expect(html).toContain('name="dir"');
    expect(html).toContain("accent-brand");
  });
  it("merges a caller className after the base", () => {
    expect(r(h(Radio, { className: "mt-1" }))).toContain("mt-1");
  });
});

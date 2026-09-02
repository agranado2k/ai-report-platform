import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Kbd } from "./Kbd";

describe("Kbd", () => {
  it("renders a <kbd> in the UI sans font (a chip, not code)", () => {
    const html = r(h(Kbd, {}, "⌘K"));
    expect(html).toMatch(/^<kbd/);
    expect(html).toContain("font-sans");
    expect(html).toContain("⌘K");
  });
});

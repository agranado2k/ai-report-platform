import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Menu, MenuItem, MenuSeparator } from "./Menu";

describe("Menu", () => {
  it("is a raised menu surface", () => {
    expect(r(h(Menu, {}, h(MenuItem, {}, "Open")))).toContain('role="menu"');
  });
  it("MenuItem is a menuitem and can carry a shortcut", () => {
    const html = r(h(MenuItem, { shortcut: "R" }, "Rename"));
    expect(html).toContain('role="menuitem"');
    expect(html).toContain("Rename");
    expect(html).toContain("R");
  });
  it("a danger item takes the danger text tier", () => {
    expect(r(h(MenuItem, { danger: true }, "Delete"))).toContain("text-danger-fg");
  });
  it("MenuSeparator is an hr", () => {
    expect(r(h(MenuSeparator, {}))).toMatch(/^<hr/);
  });
});

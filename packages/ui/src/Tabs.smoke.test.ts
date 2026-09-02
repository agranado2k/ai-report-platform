import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tab, Tabs } from "./Tabs";

describe("Tabs", () => {
  it("Tabs is a tablist", () => {
    expect(r(h(Tabs, {}, h(Tab, {}, "One")))).toContain('role="tablist"');
  });
  it("an active tab is selected and underlined; an idle one is not", () => {
    const active = r(h(Tab, { active: true }, "A"));
    expect(active).toContain('aria-selected="true"');
    expect(active).toContain("border-brand");
    const idle = r(h(Tab, {}, "B"));
    expect(idle).toContain('aria-selected="false"');
    expect(idle).toContain("border-transparent");
  });
});

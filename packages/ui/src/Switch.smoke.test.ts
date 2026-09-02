import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("is a role=switch checkbox visually hidden behind a peer-driven track", () => {
    const html = r(h(Switch, { name: "notify", defaultChecked: true }));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("sr-only");
    expect(html).toContain("peer-checked:bg-brand");
    expect(html).toContain("checked");
  });
});

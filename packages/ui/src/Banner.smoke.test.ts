import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Banner } from "./Banner";

describe("Banner", () => {
  it("a tone uses its soft fill + AA text tier and lays out title/body/action", () => {
    const html = r(
      h(
        Banner,
        { tone: "warning", title: "Flagged", action: h("button", { type: "button" }, "Review") },
        "2 scripts removed",
      ),
    );
    expect(html).toContain("bg-warning-soft");
    expect(html).toContain("text-warning-fg");
    expect(html).toContain("Flagged");
    expect(html).toContain("Review");
    expect(html).toContain('role="status"');
  });
  it("a danger banner announces assertively (role=alert), not politely", () => {
    const html = r(h(Banner, { tone: "danger", title: "Failed" }, "too big"));
    expect(html).toContain('role="alert"');
  });
});

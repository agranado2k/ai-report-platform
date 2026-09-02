import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Toast } from "./Toast";

describe("Toast", () => {
  it("renders a status card with title, body and one action, at the fixed width", () => {
    const html = r(
      h(
        Toast,
        { title: "Folder created", action: h("button", { type: "button" }, "Open") },
        "Customer research",
      ),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Folder created");
    expect(html).toContain("Customer research");
    expect(html).toContain("Open");
    expect(html).toContain("w-[356px]");
    expect(html).toContain('role="status"');
  });
  it("a danger toast announces assertively and tints its icon to the danger tier", () => {
    const html = r(h(Toast, { tone: "danger", icon: h("svg", {}), title: "Upload failed" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("text-danger-fg");
    expect(html).not.toContain("text-success-fg");
  });
});

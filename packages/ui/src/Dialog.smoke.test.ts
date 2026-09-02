import { createElement as h } from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dialog, DialogFooter, DialogTitle } from "./Dialog";

describe("Dialog", () => {
  it("is a native <dialog> with a backdrop and the 480px panel", () => {
    const html = r(h(Dialog, {}, h(DialogTitle, {}, "New folder")));
    expect(html).toMatch(/^<dialog/);
    expect(html).toContain("w-[480px]");
    expect(html).toContain("backdrop:");
    expect(html).toContain("New folder");
  });
  it("DialogTitle is an h2 and DialogFooter right-aligns actions", () => {
    expect(r(h(DialogTitle, {}, "T"))).toMatch(/^<h2/);
    expect(r(h(DialogFooter, {}, h("button", { type: "button" }, "Cancel")))).toContain(
      "justify-end",
    );
  });
});

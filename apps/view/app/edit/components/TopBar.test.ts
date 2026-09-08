// Smoke test for the reworked editor top bar (T8, report Z0W60dI8hu §06). The
// bar is a thin strip: a brand mark, the document title over the product label,
// a save-status LIVE REGION, and the Save action (plus a Back-to-document button
// in Compare mode). apps/view has no jsdom tier (vitest `environment: "node"`),
// so this pins the accessible surface via static SSR markup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TopBar, type TopBarProps } from "./TopBar";

function render(overrides: Partial<TopBarProps> = {}): string {
  const props: TopBarProps = {
    docTitle: "Q3 roadmap review",
    mode: "edit",
    onCloseCompare: () => {},
    saveStatus: "",
    saveDisabled: false,
    onSave: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(TopBar, props));
}

describe("TopBar (T8, §06)", () => {
  it("shows the document title and the product label", () => {
    const html = render();
    expect(html).toContain("Q3 roadmap review");
    expect(html).toContain("Centaur Spec");
  });

  it("keeps a save-status live region and the Save action", () => {
    const html = render({ saveStatus: "Saved as v8 — scan: clean" });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Saved as v8 — scan: clean");
    expect(html).toContain(">Save<");
  });

  it("offers Back to document only in Compare mode", () => {
    expect(render({ mode: "edit" })).not.toContain("Back to document");
    expect(render({ mode: "diff" })).toContain("Back to document");
  });

  it("disables Save while a save is in flight", () => {
    expect(render({ saveDisabled: true })).toContain("disabled");
  });
});

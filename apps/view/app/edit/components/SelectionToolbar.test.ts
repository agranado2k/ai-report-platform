// Smoke test for the Selection toolbar (ticket #296) — the floating,
// selection-anchored bar in the unified editor's Edit mode. This slice ships
// the SHELL: placeholder formatting buttons + the "…" bubble, correctly
// placed; the real commands land in later tickets. Placement/visibility
// behavior is proven in the browser tier (tests/browser/selection-toolbar
// .spec.ts); this node-tier test pins the accessible surface: a toolbar role,
// labelled buttons, and the measure-then-place lifecycle's SSR-safe start
// (offscreen until the mounted effect can measure the rendered size).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelectionToolbar } from "./SelectionToolbar";

const GEOMETRY = {
  rect: { left: 100, top: 300, right: 260, bottom: 320 },
  surface: { left: 0, top: 53, right: 680, bottom: 700 },
};

describe("SelectionToolbar", () => {
  it("renders an accessible toolbar with the placeholder actions", () => {
    const html = renderToStaticMarkup(createElement(SelectionToolbar, { geometry: GEOMETRY }));
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('data-testid="selection-toolbar"');
    for (const label of ["Bold", "Italic", "Link", "More actions"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it("starts offscreen until the mounted measurement places it", () => {
    const html = renderToStaticMarkup(createElement(SelectionToolbar, { geometry: GEOMETRY }));
    expect(html).toContain("left:-9999px");
  });
});

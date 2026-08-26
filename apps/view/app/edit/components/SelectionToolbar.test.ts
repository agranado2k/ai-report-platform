// Smoke test for the Selection toolbar (tickets #296/#297) — the floating,
// selection-anchored bar in the unified editor's Edit mode. Bold and Italic
// are live toggles (#297): active state arrives as the `formats` prop and is
// mirrored to `aria-pressed`; the Link and "…" bubble stay placeholders for
// #299/#300. Placement/visibility/toggling behavior is proven in the browser
// tier (tests/browser/selection-toolbar.spec.ts); this node-tier test pins
// the accessible surface: a toolbar role, labelled buttons, aria-pressed
// mirroring, and the measure-then-place lifecycle's SSR-safe start
// (offscreen until the mounted effect can measure the rendered size).
import type { ActiveFormats } from "arp-editor";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelectionToolbar } from "./SelectionToolbar";

const GEOMETRY = {
  rect: { left: 100, top: 300, right: 260, bottom: 320 },
  surface: { left: 0, top: 53, right: 680, bottom: 700 },
};

const NO_FORMATS: ActiveFormats = {
  strong: false,
  em: false,
  link: false,
  headingLevel: null,
  listKind: null,
};

function render(formats: ActiveFormats): string {
  return renderToStaticMarkup(
    createElement(SelectionToolbar, { geometry: GEOMETRY, formats, onToggleFormat: () => {} }),
  );
}

describe("SelectionToolbar", () => {
  it("renders an accessible toolbar with the formatting actions", () => {
    const html = render(NO_FORMATS);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('data-testid="selection-toolbar"');
    for (const label of ["Bold", "Italic", "Link", "More actions"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it("mirrors the active formats to the toggles' aria-pressed", () => {
    const idle = render(NO_FORMATS);
    expect(idle).toContain('aria-label="Bold" aria-pressed="false"');
    expect(idle).toContain('aria-label="Italic" aria-pressed="false"');

    const bolded = render({ ...NO_FORMATS, strong: true });
    expect(bolded).toContain('aria-label="Bold" aria-pressed="true"');
    expect(bolded).toContain('aria-label="Italic" aria-pressed="false"');
  });

  it("starts offscreen until the mounted measurement places it", () => {
    const html = render(NO_FORMATS);
    expect(html).toContain("left:-9999px");
  });
});

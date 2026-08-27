// Smoke test for the Selection toolbar (tickets #296/#297/#299/#298) — the
// floating, selection-anchored bar in the unified editor's Edit mode. Bold
// and Italic are live toggles (#297), Link is a live editor (#299), and the
// "…" bubble opens the Floating composer (#298, via `onCompose` — the host
// owns that swap): active state arrives as the `formats` prop and is
// mirrored to `aria-pressed`. Placement/
// visibility/interaction behavior (including the whole link add/edit/remove
// flow and the composer swap) is proven in the browser tier
// (tests/browser/selection-toolbar.spec.ts); this node-tier test pins the
// accessible surface: a toolbar role, labelled buttons, aria-pressed
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
  linkHref: null,
  headingLevel: null,
  listKind: null,
};

function render(formats: ActiveFormats): string {
  return renderToStaticMarkup(
    createElement(SelectionToolbar, {
      geometry: GEOMETRY,
      formats,
      onToggleFormat: () => {},
      onToggleHeading: () => {},
      onToggleList: () => {},
      onApplyLink: () => true,
      onRemoveLink: () => true,
      onCompose: () => {},
    }),
  );
}

describe("SelectionToolbar", () => {
  it("renders an accessible toolbar with the formatting actions", () => {
    const html = render(NO_FORMATS);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('data-testid="selection-toolbar"');
    for (const label of [
      "Bold",
      "Italic",
      "Link",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bullet list",
      "Ordered list",
      "More actions",
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it("mirrors the heading level to aria-pressed, distinguishing levels (ticket #300)", () => {
    const h2 = render({ ...NO_FORMATS, headingLevel: 2 });
    expect(h2).toContain('aria-label="Heading 2" aria-pressed="true"');
    expect(h2).toContain('aria-label="Heading 3" aria-pressed="false"');
    expect(h2).toContain('aria-label="Heading 1" aria-pressed="false"');

    // A level the toolbar does not expose (schema allows 1-6) lights nothing.
    const h4 = render({ ...NO_FORMATS, headingLevel: 4 });
    expect(h4).toContain('aria-label="Heading 2" aria-pressed="false"');
    expect(h4).toContain('aria-label="Heading 3" aria-pressed="false"');
  });

  it("mirrors the list kind to aria-pressed, distinguishing bullet from ordered (ticket #300)", () => {
    const bullet = render({ ...NO_FORMATS, listKind: "bullet" });
    expect(bullet).toContain('aria-label="Bullet list" aria-pressed="true"');
    expect(bullet).toContain('aria-label="Ordered list" aria-pressed="false"');

    const ordered = render({ ...NO_FORMATS, listKind: "ordered" });
    expect(ordered).toContain('aria-label="Bullet list" aria-pressed="false"');
    expect(ordered).toContain('aria-label="Ordered list" aria-pressed="true"');
  });

  it("mirrors the active formats to the toggles' aria-pressed", () => {
    const idle = render(NO_FORMATS);
    expect(idle).toContain('aria-label="Bold" aria-pressed="false"');
    expect(idle).toContain('aria-label="Italic" aria-pressed="false"');

    const bolded = render({ ...NO_FORMATS, strong: true });
    expect(bolded).toContain('aria-label="Bold" aria-pressed="true"');
    expect(bolded).toContain('aria-label="Italic" aria-pressed="false"');

    // The Link button reads pressed inside an existing link (ticket #299).
    const linked = render({ ...NO_FORMATS, link: true, linkHref: "https://example.com" });
    expect(linked).toContain('aria-label="Link" aria-pressed="true"');
  });

  it("starts offscreen until the mounted measurement places it", () => {
    const html = render(NO_FORMATS);
    expect(html).toContain("left:-9999px");
  });
});

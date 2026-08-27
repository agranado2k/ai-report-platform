// Smoke test for the Floating composer (ticket #298) — the selection-anchored
// comment composer the Selection toolbar's "…" bubble swaps in. Interaction
// behavior (open-from-toolbar, Cmd/Ctrl+Enter posting, Escape cancel, the
// highlight + panel side effects, the inline post-failure error) is proven in
// the browser tier (tests/browser/selection-toolbar.spec.ts); this node-tier
// test pins the accessible surface: a labelled dialog, the quoted selection,
// the body field, the full closed intent enum defaulting to `note`, the
// submit/cancel pair, and the measure-then-place lifecycle's SSR-safe start
// (offscreen until the mounted effect can measure the rendered size — same
// contract as SelectionToolbar).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FloatingComposer } from "./FloatingComposer";

const GEOMETRY = {
  rect: { left: 100, top: 300, right: 260, bottom: 320 },
  surface: { left: 0, top: 53, right: 680, bottom: 700 },
};

function render(quote: string): string {
  return renderToStaticMarkup(
    createElement(FloatingComposer, {
      geometry: GEOMETRY,
      quote,
      onSubmit: async () => ({ ok: true }) as const,
      onCancel: () => {},
    }),
  );
}

describe("FloatingComposer", () => {
  it("renders an accessible dialog with quote, body, intent, submit and cancel", () => {
    const html = render("the selected words");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="New comment"');
    expect(html).toContain('data-testid="floating-composer"');
    expect(html).toContain("the selected words");
    expect(html).toContain('aria-label="Comment body"');
    expect(html).toContain('aria-label="Post comment"');
    expect(html).toContain('aria-label="Cancel comment"');
  });

  it("offers the full closed intent enum with note (the default) selected", () => {
    const html = render("q");
    for (const label of ["Note", "Enhance", "Add", "Remove"]) {
      expect(html).toContain(`>${label}</option>`);
    }
    // React SSR marks the CONTROLLED select's current value on its option —
    // `note` is the default the domain enum specifies (ADR-0064 Decision 8).
    expect(html).toContain('<option value="note" selected="">');
  });

  it("truncates a long quote instead of growing the bubble unbounded", () => {
    const html = render("x".repeat(500));
    expect(html).not.toContain("x".repeat(120));
  });

  it("starts offscreen until the mounted measurement places it", () => {
    const html = render("q");
    expect(html).toContain("left:-9999px");
  });
});

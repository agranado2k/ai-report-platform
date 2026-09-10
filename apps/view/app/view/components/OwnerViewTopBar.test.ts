// Smoke test for the owner view's chrome strip (ADR-0089 §1). apps/view has no
// jsdom tier (vitest `environment: "node"`), so this pins the accessible
// surface via static SSR markup, exactly as TopBar.test.ts does for the
// editor's bar. Interactive behaviour belongs to the browser tier.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerViewTopBar, type OwnerViewTopBarProps } from "./OwnerViewTopBar";

function render(overrides: Partial<OwnerViewTopBarProps> = {}): string {
  const props: OwnerViewTopBarProps = {
    docTitle: "Q3 roadmap review",
    shareState: "Private",
    versionsHref: "/abcde12345/edit",
    editHref: "/abcde12345/edit",
    canEdit: true,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(OwnerViewTopBar, props));
}

describe("OwnerViewTopBar", () => {
  it("wears the same strip as the editor — title over the product label", () => {
    const html = render();
    expect(html).toContain("Q3 roadmap review");
    expect(html).toContain("Centaur Spec");
  });

  it("answers 'who can see this?' — the question the canonical URL cannot", () => {
    expect(render({ shareState: "Anyone with the link" })).toContain("Anyone with the link");
  });

  it("offers Versions and Edit as real links, not buttons", () => {
    // Real anchors: middle-clickable, focusable, announced as links. Both are
    // plain navigations — this bar makes no cross-origin call (ADR-0089 §6).
    const html = render();
    expect(html).toContain('href="/abcde12345/edit"');
    expect(html).toContain("Versions");
    expect(html).toContain("Edit");
  });

  it("withholds Edit on the owner-read degrade, but keeps the rest of the chrome", () => {
    // The visitor proved ownership with a verified `oa` fallback and holds no
    // edit capability, so the action that would fail is not offered — they
    // still get the report and the chrome around it, which is the whole
    // improvement over ADR-0063's bare-viewer degrade.
    const html = render({ canEdit: false });
    expect(html).not.toContain(">Edit<");
    expect(html).toContain("Versions");
    expect(html).toContain("Q3 roadmap review");
  });

  it("renders an author-controlled title as text, never as markup", () => {
    const html = render({ docTitle: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

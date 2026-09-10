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
    // DISTINCT on purpose, even though the route happens to point both at the
    // editor today (versions live in the editor's own side panel). Given both
    // the same value, every assertion below would survive the two hrefs being
    // swapped — the bar could send Edit to the Versions destination and the
    // suite would stay green. A fixture that cannot express the bug cannot
    // catch it, and these are two user intents that are allowed to diverge.
    versionsHref: "/abcde12345/edit?panel=versions",
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

  it("offers Versions and Edit as real links, not buttons — each to its OWN href", () => {
    // Real anchors: middle-clickable, focusable, announced as links. Both are
    // plain navigations — this bar makes no cross-origin call (ADR-0089 §6).
    //
    // Asserted as href-to-label PAIRS rather than as two independent
    // `toContain`s: the failure worth catching is not a missing link, it is the
    // two destinations wired to the wrong labels, which sends an owner who
    // clicked Edit somewhere else.
    const html = render();
    expect(html).toMatch(/href="\/abcde12345\/edit\?panel=versions"[^>]*>Versions</);
    expect(html).toMatch(/href="\/abcde12345\/edit"[^>]*>Edit</);
  });

  it("withholds Edit on the owner-read degrade, but keeps the rest of the chrome", () => {
    // The visitor proved ownership with a verified `oa` fallback and holds no
    // edit capability, so the action that would fail is not offered — they
    // still get the report and the chrome around it, which is the whole
    // improvement over ADR-0063's bare-viewer degrade.
    const html = render({ canEdit: false });
    expect(html).not.toContain(">Edit<");
    // The Versions link survives with its own destination intact — the degrade
    // withholds one action, it does not collapse the bar onto one href.
    expect(html).toMatch(/href="\/abcde12345\/edit\?panel=versions"[^>]*>Versions</);
    expect(html).toContain("Q3 roadmap review");
  });

  it("renders an author-controlled title as text, never as markup", () => {
    const html = render({ docTitle: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

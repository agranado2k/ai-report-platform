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

  it("withholds BOTH actions on the owner-read degrade, but keeps the chrome", () => {
    // The visitor proved ownership with a verified `oa` fallback and holds no
    // edit capability. Neither action is offered, and Versions is withheld for
    // the SAME reason Edit is: it navigates to `/<slug>/edit`, which — holding
    // no capability under that Path — funnels through the app's mint and
    // re-checks `canWrite` live. Offering it to a holder who has just been
    // told they cannot edit is an invitation to a round-trip that ends where
    // they started.
    //
    // What survives is the point of the degrade: the report, the title, and
    // the share state — chrome around a working report, which is the whole
    // improvement over ADR-0063's bare-viewer fallback.
    const html = render({ canEdit: false });
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain(">Versions<");
    expect(html).not.toContain("/abcde12345/edit");
    expect(html).toContain("Q3 roadmap review");
    expect(html).toContain("Private");
  });

  it("renders an author-controlled title as text, never as markup", () => {
    const html = render({ docTitle: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

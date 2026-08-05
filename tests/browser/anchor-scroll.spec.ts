// BROWSER regression coverage for in-page anchor links in the editor
// (the tier is ADR-0079; the behavior is ADR-0062 Amendment 3, Decision 7).
//
// WHY THIS TIER EXISTS AT ALL. The anchor feature shipped in PR #243 with a
// green unit suite and was inert in production: clicking a TOC link left the
// document exactly where it was. Every unit test passed both before and after
// the fix, because the bug was not in any pure function — it was an ORDERING
// fact about a real browser and a mounted ProseMirror. A node-tier test
// literally cannot see it. This file is the tier that can.
//
// It is hermetic: no deployment, no auth, no database. The harness page
// (harness/build.mts) bundles the REAL `ReportEditor` over a report parsed by
// the REAL `parseBody`, laid out the way apps/view's `/edit` route lays it
// out, and the test drives it with real mouse input.
import { expect, test } from "@playwright/test";
import { buildHarness } from "./harness/build.mjs";

type Page = import("@playwright/test").Page;

let harnessPage: string;

test.beforeAll(async () => {
  harnessPage = await buildHarness();
});

/** How far off the expected offset a reading may be. Sub-pixel layout and the
 *  rounding above account for a pixel or two; anything larger is a real
 *  difference in where the document ended up. */
const SLOP_PX = 4;

/** How long the anchor scroll has to ARRIVE. Deliberately tight: the fix
 *  scrolls instantly, so it lands within a frame or two. A re-introduced
 *  `behavior: "smooth"` animation over ~1100px does not — which is precisely
 *  the regression the old `waitForTimeout(1500)` could not see, because a
 *  sleep long enough to outlast a smooth scroll is a sleep long enough to hide
 *  one. */
const ARRIVAL_MS = 1000;

/** How long the scroll then has to STAY. The competing caret reveal fires
 *  ~20ms after the click; this window is generous enough to cover it and any
 *  later re-sync. Unlike the arrival deadline this is genuinely a duration —
 *  "nothing moved it back" is only observable by waiting. */
const HOLD_MS = 250;

/** The editing surface's own scroll offset and where the anchor target sits —
 *  both read from the PARENT realm, since the iframe is
 *  `sandbox="allow-same-origin"` with no `allow-scripts`.
 *
 *  THROWS when the surface or the target is missing. The previous version
 *  returned `-1` for a missing element, which turned "the fixture stopped
 *  rendering" into an ordinary number that assertions then compared against —
 *  and some of them would have passed. */
async function readEditorScroll(page: Page, targetId: string) {
  return await page.evaluate((id) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow;
    if (!doc || !win) throw new Error("the editing surface has not mounted");
    const target = doc.getElementById(id);
    if (!target) throw new Error(`the editing surface has no #${id}`);
    const scrollY = Math.round(win.scrollY);
    const targetTop = Math.round(target.getBoundingClientRect().top);
    return {
      scrollY,
      /** Signed distance from the top of the viewport — negative means the
       *  document was scrolled PAST the target. */
      targetTop,
      viewportHeight: doc.documentElement.clientHeight,
      /** Where the target sits in the DOCUMENT, independent of the current
       *  scroll — i.e. the scroll offset that top-aligns it. */
      documentTop: scrollY + targetTop,
      /** The largest offset the surface can be scrolled to. */
      maxScrollY: doc.documentElement.scrollHeight - doc.documentElement.clientHeight,
    };
  }, targetId);
}

/** Where ProseMirror's OWN selection ended up.
 *
 *  This is the one assertion about the MECHANISM rather than the outcome, and
 *  it is here because every other assertion in this file depends on
 *  `armCaretReveal` — a hand-written stand-in for a competing scroll. A guard
 *  built only on a modelled competitor protects against a regression of the
 *  MODEL. "PM's selection is inside the anchor target" is true of the fix and
 *  false of anything that scrolls behind PM's back, no matter how the timing
 *  is simulated, so it cannot silently pass if the fix is undone.
 *
 *  Read through the DOM selection because that is what PM writes its selection
 *  out to (`selectionToDOM`), and it is observable across the realm boundary
 *  without reaching into ProseMirror's internals. */
async function readEditorSelection(page: Page, targetId: string) {
  return await page.evaluate((id) => {
    const doc = (document.querySelector("iframe") as HTMLIFrameElement | null)?.contentDocument;
    if (!doc) throw new Error("the editing surface has not mounted");
    const target = doc.getElementById(id);
    if (!target) throw new Error(`the editing surface has no #${id}`);
    const anchorNode = doc.getSelection()?.anchorNode ?? null;
    return {
      hasSelection: anchorNode !== null,
      insideTarget: anchorNode !== null && target.contains(anchorNode),
      /** A NodeSelection renders as `.ProseMirror-selectednode`, and would mean
       *  the next keystroke replaces the element (editor-state.ts refuses to
       *  produce one for an anchor). */
      nodeSelected: doc.querySelector(".ProseMirror-selectednode") !== null,
    };
  }, targetId);
}

/**
 * The whole contract of an anchor click, asserted against the actual scroll
 * offset rather than against "the target is somewhere near the top".
 *
 * WHY THE OLD ASSERTION WAS NOT A TEST. It read
 * `after.targetTop < viewportHeight / 2` on a target that sat BELOW the
 * document's maximum scroll offset, so it was unreachable-by-top-alignment and
 * the passing state was literally "scrolled to the bottom of the document" —
 * `scrollTo(0, 1e6)` on any fragment click made all three scroll tests green.
 * The fixture now carries a trailing runway so top alignment is reachable, and
 * the expected offset is DERIVED from the target's own position in the
 * document, so nothing but landing on the anchor satisfies it.
 */
async function expectAnchorRevealed(
  page: Page,
  targetId: string,
  before: Awaited<ReturnType<typeof readEditorScroll>>,
) {
  // The premise the assertions rest on: the anchor is below the fold to start
  // with, and top-aligning it is actually reachable. Both are properties of
  // the fixture, so they are checked rather than assumed — a fixture that
  // drifts should fail loudly here, not quietly weaken every test below.
  expect(before.targetTop).toBeGreaterThan(before.viewportHeight);
  expect(before.documentTop).toBeLessThanOrEqual(before.maxScrollY);
  const expected = before.documentTop;

  // ARRIVES, and promptly.
  await expect
    .poll(async () => Math.abs((await readEditorScroll(page, targetId)).scrollY - expected), {
      timeout: ARRIVAL_MS,
    })
    .toBeLessThanOrEqual(SLOP_PX);

  // STAYS. Nothing dragged it back once the competitor had run.
  await page.waitForTimeout(HOLD_MS);
  const after = await readEditorScroll(page, targetId);
  expect(after.scrollY).toBeGreaterThanOrEqual(expected - SLOP_PX);
  expect(after.scrollY).toBeLessThanOrEqual(expected + SLOP_PX);
  // Top-aligned, and NOT overshot: a negative `targetTop` means the document
  // scrolled past the anchor, which a signed reading alone would have hidden.
  expect(after.targetTop).toBeGreaterThanOrEqual(0);
  expect(after.targetTop).toBeLessThanOrEqual(SLOP_PX);

  // And the mechanism, not just the outcome.
  const selection = await readEditorSelection(page, targetId);
  expect(selection.insideTarget).toBe(true);
  expect(selection.nodeSelected).toBe(false);
}

/** Click a link at its real on-screen position WITHOUT Playwright's
 *  auto-scroll: `locator.click()` scrolls the target into view first, which
 *  changes the very scroll state under test. */
async function clickLinkInEditor(page: Page, href: string) {
  const point = await linkPoint(page, href);
  await page.mouse.click(point.x, point.y);
}

/** The centre of a link, in PARENT-page coordinates. */
async function linkPoint(page: Page, href: string) {
  return await elementBox(page, `a[href="${href}"]`);
}

/** An element inside the editing surface, in PARENT-page coordinates — the
 *  frame between the two realms is the iframe's own offset. */
async function elementBox(page: Page, selector: string) {
  return await page.evaluate((sel) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const frame = iframe.getBoundingClientRect();
    const el = iframe.contentDocument?.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`the editing surface has no ${sel}`);
    const rect = el.getBoundingClientRect();
    return {
      x: frame.left + rect.left + rect.width / 2,
      y: frame.top + rect.top + rect.height / 2,
      left: frame.left + rect.left,
      right: frame.left + rect.right,
      top: frame.top + rect.top,
      bottom: frame.top + rect.bottom,
    };
  }, selector);
}

/**
 * Stand in for the post-click scroll that reveals wherever the caret ended up.
 *
 * A MODEL, and named as one. In production something scrolls the surface back
 * to the caret shortly after a click; ProseMirror re-syncs its selection to
 * the DOM about 20ms later (`DOMObserver.flushSoon` → `flush` →
 * `selectionToDOM`), which fits the timeline. WHICH mechanism actually
 * performs the scroll is NOT established — two candidates were checked
 * against prosemirror-view 1.42.0's source and refuted (see
 * `anchorScrollTransaction`'s doc comment in packages/editor). So this helper
 * reproduces the SHAPE of the competitor — "20ms after the click, scroll
 * whatever holds the caret into view" — with deterministic timing, rather
 * than claiming to be PM's own code path.
 *
 * That is also this tier's honest limitation: the discriminating power of the
 * scroll tests rests on this model, so a change in PM's real behavior would
 * not be caught here. The selection assertion in `expectAnchorRevealed` is
 * the one guard that does not depend on it.
 */
async function armCaretReveal(page: Page) {
  await page.evaluate(() => {
    const doc = (document.querySelector("iframe") as HTMLIFrameElement).contentDocument as Document;
    doc.addEventListener(
      "click",
      () => {
        setTimeout(() => {
          const node = doc.getSelection()?.anchorNode ?? null;
          const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
          el?.scrollIntoView({ behavior: "auto", block: "nearest" });
        }, 20);
      },
      true,
    );
  });
}

test.describe("in-page anchor links in the editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${harnessPage}`);
    // The editor mounts in a client effect once the srcdoc iframe has loaded.
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (document.querySelector("iframe") as HTMLIFrameElement)?.contentDocument?.querySelector(
              'a[href="#deep-section"]',
            ) !== null,
        ),
      )
      .toBe(true);
  });

  test("clicking a fragment link scrolls the editing surface to that section", async ({ page }) => {
    const before = await readEditorScroll(page, "deep-section");
    expect(before.scrollY).toBe(0);

    await clickLinkInEditor(page, "#deep-section");

    await expectAnchorRevealed(page, "deep-section", before);
  });

  test("an id on a heading scrolls too, not just an id on a section", async ({ page }) => {
    const before = await readEditorScroll(page, "section-two");

    await clickLinkInEditor(page, "#section-two");

    await expectAnchorRevealed(page, "section-two", before);
  });

  // THE REGRESSION. This is the exact failure that shipped: the anchor scroll
  // was issued behind ProseMirror's back while the caret stayed on the TOC
  // link, so a scroll that revealed the caret ~20ms later dragged the
  // document straight back — and because the anchor scroll was a
  // `behavior: "smooth"` animation, it was abandoned mid-flight and never
  // resumed. Measured against the shipped code with this very harness: the
  // document ended near scrollY 0 with the target still more than a thousand
  // pixels below the fold, i.e. visually "the click did nothing".
  test("the scroll survives ProseMirror's post-click caret reveal", async ({ page }) => {
    await armCaretReveal(page);
    const before = await readEditorScroll(page, "deep-section");
    expect(before.scrollY).toBe(0);

    await clickLinkInEditor(page, "#deep-section");

    await expectAnchorRevealed(page, "deep-section", before);
  });

  test("an external link still opens a new tab, and is not scrolled to", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = (url?: string | URL) => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null;
      };
    });

    await clickLinkInEditor(page, "https://example.com/");

    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
      .toEqual(["https://example.com/"]);
    // And the surface stayed put — asserted after the same hold window the
    // anchor cases use, so a late scroll would be seen rather than slept
    // through.
    await page.waitForTimeout(HOLD_MS);
    expect((await readEditorScroll(page, "deep-section")).scrollY).toBe(0);
  });

  test("Alt+click suppresses activation so the link text stays editable", async ({ page }) => {
    const point = await linkPoint(page, "#deep-section");
    await page.keyboard.down("Alt");
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up("Alt");

    await page.waitForTimeout(HOLD_MS);
    expect((await readEditorScroll(page, "deep-section")).scrollY).toBe(0);
  });

  // THE LAST LEG OF THE CLICK-DISPATCH MATRIX. Comment click-to-highlight
  // rides the SAME `handleDOMEvents.click` handler as link activation — the
  // two are resolved against each other by `editorClickOutcome` — so a
  // fixture with no comments left half of the handler untested in the only
  // tier that can see a real click. It is also the leg that was already
  // broken once for exactly this class of reason: PM's `handleClick` never
  // fired inside this sandboxed iframe, which no unit test could observe.
  test("clicking a comment highlight focuses that comment", async ({ page }) => {
    // Make a real selection with real mouse input (a double-click selects the
    // word under the pointer), then turn it into a comment the way the route
    // does — rather than hand-computing ProseMirror positions here.
    const paragraph = await elementBox(page, "#filler p");
    await page.mouse.dblclick(paragraph.left + 10, paragraph.y);

    await expect(page.getByTestId("pending-selection")).not.toHaveText("");
    await page.getByTestId("add-comment").click();
    await expect(page.locator("iframe").contentFrame().locator(".comment-highlight")).toHaveCount(
      1,
    );

    const highlight = await elementBox(page, ".comment-highlight");
    await page.mouse.click(highlight.x, highlight.y);

    await expect(page.getByTestId("focused-comment")).toHaveText("comment-1");
  });
});

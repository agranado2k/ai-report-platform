// BROWSER regression coverage for in-page anchor links in the editor
// (the tier is ADR-0079; the behavior is ADR-0062 Amendment 3, Decision 7).
//
// WHY THIS TIER EXISTS AT ALL. The anchor feature shipped in PR #243 with a
// green unit suite and was inert in production: clicking a TOC link left the
// document where it was. Every unit test passed both before and after the fix,
// because whatever the bug is, it is not in any pure function — it is a fact
// about a real browser and a mounted ProseMirror, which a node-tier test
// cannot see at all.
//
// AND THIS TIER HAS NOT REPRODUCED IT EITHER, across three rounds. Every
// contract below passes on the shipped code as well as the fixed code; the one
// test that goes red on the old design does so against a competitor this file
// INVENTS (`armCaretReveal`). So read this suite as a regression net for the
// behaviours it states, not as evidence about the production failure — and do
// not treat a green run here as a diagnosis.
//
// It is hermetic: no deployment, no auth, no database. The harness page
// (harness/build.mts) bundles the REAL `ReportEditor` over a report parsed by
// the REAL `parseBody`, laid out the way apps/view's `/edit` route lays it
// out, and the test drives it with real mouse input.
//
// EVERY CONTRACT BELOW RUNS TWICE, over two fixtures that differ in exactly
// one respect: whether the report's own stylesheet sets `scroll-behavior`.
// That is not decoration. `scrollIntoView({behavior: "auto"})` and
// ProseMirror's own `window.scrollBy()` both DEFER to that property, so the
// same code means different things on the two documents, and a suite that runs
// only one of them cannot say which meaning it just tested. The no-`scroll-
// behavior` fixture is the one that matters most for provenance: the document
// the operator measured the production anchor failure on had no such rule, so
// on it `auto` already resolved to instant — and this tier is where that can be
// shown rather than argued.
import { expect, test } from "@playwright/test";
import { buildHarness } from "./harness/build.mjs";

type Page = import("@playwright/test").Page;

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
      /** The target's own `scroll-margin-top`, which is how far BELOW the
       *  viewport's top edge a "top-aligned" scroll is required to leave it.
       *  Read from the live computed style rather than assumed to be 0: the
       *  real generated report styles `section { scroll-margin-top: 1rem }`,
       *  so a suite that hard-codes 0 asserts a landing position production
       *  does not produce. */
      scrollMarginTop: Number.parseFloat(win.getComputedStyle(target).scrollMarginTop || "0"),
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
 *
 * "TOP-ALIGNED" MEANS `scroll-margin-top` BELOW THE TOP EDGE, not zero. The
 * real generated report styles `section { scroll-margin-top: 1rem }`, and
 * `scrollIntoView({block: "start"})` honours it, so the landing position is
 * `documentTop - scrollMarginTop`. Hard-coding 0 here made these assertions
 * describe a document no real report produces — the whole failure mode ADR-0079
 * exists to prevent — and it is read from the live computed style so a fixture
 * that changes its margin re-derives rather than drifting.
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
  const margin = before.scrollMarginTop;
  const expected = before.documentTop - margin;

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
  expect(after.targetTop).toBeGreaterThanOrEqual(margin - SLOP_PX);
  expect(after.targetTop).toBeLessThanOrEqual(margin + SLOP_PX);

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
 * A MODEL, AND AN UNCORROBORATED ONE. It reproduces the SHAPE a competing
 * scroll would have — "20ms after the click, scroll whatever holds the caret
 * into view" — with deterministic timing. ProseMirror does re-sync its
 * selection to the DOM on roughly that cadence (`DOMObserver.flushSoon` →
 * `flush` → `selectionToDOM`), which is where the 20ms comes from.
 *
 * NOTHING HAS EVER OBSERVED SUCH A SCROLL IN THE MOUNTED EDITOR. Instrumenting
 * the surface's `scroll` events through a real anchor click shows exactly two
 * writes — PM's minimal reveal, then the DOM top-alignment — and nothing after
 * them, on both fixtures and on the real 86KB generated report. Three
 * candidate mechanisms have been checked against prosemirror-view 1.42.0's
 * source and refuted (see `anchorScrollTransaction`'s doc comment in
 * packages/editor).
 *
 * That is this tier's honest limitation, and it is a large one: the
 * discriminating power of the scroll tests rests on a competitor this suite
 * invents. The selection assertion in `expectAnchorRevealed` is the one guard
 * that does not depend on it — and the reported production failure is still
 * not reproduced by any test in this file.
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

/** The two report documents this contract runs against. */
const FIXTURES = [
  {
    file: "report.html",
    label: "a report whose CSS asks for smooth scrolling",
    /** Whether this fixture's own stylesheet sets `scroll-behavior: smooth`.
     *  Only the smooth one can assert that the editor's injected override wins
     *  the cascade — on the other there is nothing to override. */
    asksForSmooth: true,
  },
  {
    file: "plain-report.html",
    label: "a report with no scroll-behavior at all (the measured production document)",
    asksForSmooth: false,
  },
] as const;

for (const fixture of FIXTURES) {
  test.describe(`in-page anchor links in the editor — ${fixture.label}`, () => {
    let harnessPage: string;

    test.beforeAll(async () => {
      harnessPage = await buildHarness(fixture.file);
    });

    test.beforeEach(async ({ page }) => {
      await page.goto(`file://${harnessPage}`);
      // The editor mounts in a client effect once the srcdoc iframe has loaded.
      await expect
        .poll(async () =>
          page.evaluate(
            () =>
              (
                document.querySelector("iframe") as HTMLIFrameElement
              )?.contentDocument?.querySelector('a[href="#deep-section"]') !== null,
          ),
        )
        .toBe(true);
    });

    test("clicking a fragment link scrolls the editing surface to that section", async ({
      page,
    }) => {
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

    // THE MODELLED REGRESSION, and the word "modelled" is doing real work.
    // `armCaretReveal` installs a competitor that reveals the caret ~20ms after
    // a click; against an anchor scroll issued BEHIND ProseMirror's back it
    // drags the document straight back to the TOC link. That is a genuine
    // failure of the pre-#243 design and this test does catch it.
    //
    // It is NOT a reproduction of the reported production failure. No such
    // competitor has ever been observed in the mounted editor — on either
    // fixture, or on the real 86KB generated report — and the candidates for
    // one have been checked against prosemirror-view's source and refuted
    // (`anchorScrollTransaction`, packages/editor/src/editor-state.ts).
    test("the scroll survives ProseMirror's post-click caret reveal", async ({ page }) => {
      await armCaretReveal(page);
      const before = await readEditorScroll(page, "deep-section");
      expect(before.scrollY).toBe(0);

      await clickLinkInEditor(page, "#deep-section");

      await expectAnchorRevealed(page, "deep-section", before);
    });

    // WHETHER THE EDITOR'S INJECTED CSS WINS THE CASCADE against the report's
    // own untrusted stylesheet is a question about a real browser's cascade,
    // not about a string — so it is asserted here and nowhere else.
    //
    // ProseMirror's own reveal — `scrollRectIntoView` → `window.scrollBy(x, y)`
    // at the top level, `elt.scrollTop += moveY` for a nested scroll box — takes
    // no behavior argument in either branch, so it obeys the `scroll-behavior`
    // of whatever it scrolls. A report that sets `html { scroll-behavior:
    // smooth }` (one real generated report does) therefore turns PM's reveal
    // into a ~1.5s animation over a long document. That is a latent defect worth
    // removing on its own terms; it is NOT the cause of the production anchor
    // failure, which was measured on a document with no such rule.
    test("the editing surface never animates the scrolls it can control", async ({ page }) => {
      const behavior = await page.evaluate(() => {
        const doc = (document.querySelector("iframe") as HTMLIFrameElement | null)?.contentDocument;
        if (!doc?.defaultView) throw new Error("the editing surface has not mounted");
        // Read from the surface's OWN realm — a parent-realm `getComputedStyle`
        // would be resolving against the wrong document.
        return {
          root: doc.defaultView.getComputedStyle(doc.documentElement).scrollBehavior,
          body: doc.defaultView.getComputedStyle(doc.body).scrollBehavior,
          // The premise, so each fixture fails for the right reason rather than
          // because a rule silently vanished (or appeared). CSS COMMENTS ARE
          // STRIPPED FIRST: the editor's own injected <style> carries a prose
          // comment containing the literal `scroll-behavior: smooth`, and
          // without this the premise matched on EVERY document — including the
          // fixture whose entire point is not to ask for smooth.
          asksForSmooth: Array.from(doc.querySelectorAll("style")).some((s) =>
            /scroll-behavior:\s*smooth/.test(
              (s.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, ""),
            ),
          ),
        };
      });

      expect(behavior.asksForSmooth).toBe(fixture.asksForSmooth);
      expect(behavior.root).toBe("auto");
      expect(behavior.body).toBe("auto");
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
        .poll(async () =>
          page.evaluate(() => (window as unknown as { __opened: string[] }).__opened),
        )
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
}

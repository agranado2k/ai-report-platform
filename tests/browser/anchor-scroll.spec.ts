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
// AND THIS TIER HAS NOT REPRODUCED IT EITHER, across four rounds. Every
// contract below passes on the shipped code as well as the fixed code; the one
// test that goes red on the old design does so against a competitor this file
// INVENTS (`armCaretReveal`). So read this suite as a regression net for the
// behaviours it states, not as evidence about the production failure — and do
// not treat a green run here as a diagnosis.
//
// WHAT ROUND FOUR DID ESTABLISH is negative and worth more than another
// theory: the production trace that reported the top-alignment pass MISSING
// ("`scrollIntoView` was never invoked") was wrapping
// `iframe.contentWindow.Element.prototype.scrollIntoView`, and that prototype
// is not on the call's lookup path — ProseMirror renders the report with the
// PARENT window's constructors. Written the same way here, against a document
// where the jump provably lands, the instrument is equally silent. Both facts
// are now tests below ("the top-alignment pass really calls scrollIntoView on
// the anchor" and "ProseMirror renders the report with the PARENT realm's
// constructors"), so the mistake cannot be made a second time.
//
// It is hermetic: no deployment, no auth, no database. The harness page
// (harness/build.mts) bundles the REAL `ReportEditor` over a report parsed by
// the REAL `parseBody`, laid out the way apps/view's `/edit` route lays it
// out, and the test drives it with real mouse input.
//
// EVERY CONTRACT BELOW RUNS OVER THREE DOCUMENTS, in two Playwright projects.
//
// The `chromium` project runs the two SYNTHETIC fixtures, which differ in
// exactly one respect: whether the report's own stylesheet sets
// `scroll-behavior`. That is not decoration. `scrollIntoView({behavior:
// "auto"})` and ProseMirror's own `window.scrollBy()` both DEFER to that
// property, so the same code means different things on the two documents, and a
// suite that runs only one of them cannot say which meaning it just tested. The
// no-`scroll-behavior` fixture is the one that matters most for provenance: the
// document the operator measured the production anchor failure on had no such
// rule, so on it `auto` already resolved to instant — and this tier is where
// that can be shown rather than argued.
//
// The `real-report` project runs the SAME contracts over
// `packages/report-html/src/fixtures/ai-readiness-report.html` — a verbatim
// generated report, 86KB, nine sections, a 20,828px scroll range — and it
// exists because ADR-0079's fixture rule ("a fixture may be smaller than a real
// report, never different IN KIND") was broken by the very commit that wrote it,
// and the mechanical guard that followed (harness/fixture-fidelity.test.ts) can
// only catch a scroll-relevant declaration that is MISSING. It cannot catch a
// DOM shaped differently, content two orders of magnitude longer, or an anchor
// whose `scroll-margin-top` makes "top-aligned" mean 16px rather than 0. A
// second project running the real document can, and now does, on every PR.
//
// A fixture that genuinely cannot satisfy a contract is EXCLUDED EXPLICITLY,
// with the reason on the fixture table — see `headingAnchor`, which is `null`
// for the real report because it puts all nine anchor ids on `<section>`
// elements and has no heading id to click.
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

/**
 * Record every `scrollIntoView` call made on an element in the editing
 * surface — instrumenting BOTH realms, and labelling which one saw it.
 *
 * ASSERTING THE CALL IS THE POINT. Every other scroll assertion in this file
 * reads a final offset, and a final offset is satisfiable by accident: the
 * suite passed three times over a product the operator was measuring as
 * broken. "`deferAnchorScroll` reached `scrollIntoView` with these options"
 * is a claim about the code path, and nothing but the code path satisfies it.
 *
 * BOTH REALMS, BECAUSE ONE OF THEM SEES NOTHING AND THAT IS NOT OBVIOUS.
 * `packages/editor`'s source comments asserted for three rounds that nodes in
 * the editing surface belong to the IFRAME's realm ("`instanceof HTMLElement`
 * against the parent's constructor is `false`"). For ProseMirror-rendered
 * nodes that is exactly backwards — see the realm test below — so patching
 * `iframe.contentWindow.Element.prototype.scrollIntoView` records ZERO calls
 * no matter how well the feature works. That is the instrumentation the
 * operator ran against production, and its silence was read as "the
 * top-alignment pass never executes". Written the same way here it is equally
 * silent, on a document where the jump provably lands (see the offset tests
 * above) — so the silence measures the instrument, not the product.
 *
 * Spying on the PARENT prototype alone would leave that trap intact for the
 * next person; recording the realm makes it an assertion.
 */
async function armScrollIntoViewSpy(page: Page) {
  await page.evaluate(() => {
    const win = (document.querySelector("iframe") as HTMLIFrameElement | null)?.contentWindow;
    if (!win) throw new Error("the editing surface has not mounted");
    const calls: { realm: string; on: string; args: string }[] = [];
    (window as unknown as { __sivCalls: typeof calls }).__sivCalls = calls;
    const spyOn = (realm: string, ctor: { prototype: unknown }) => {
      const proto = ctor.prototype as Record<string, unknown>;
      const original = proto.scrollIntoView as (...a: unknown[]) => void;
      proto.scrollIntoView = function (this: Element, ...args: unknown[]) {
        calls.push({
          realm,
          on: `${this.tagName.toLowerCase()}#${this.id}`,
          args: JSON.stringify(args),
        });
        return original.apply(this, args);
      };
    };
    spyOn("iframe", (win as unknown as { Element: { prototype: unknown } }).Element);
    spyOn("parent", Element);
  });
}

/** Calls recorded on one element, in call order. */
async function readScrollIntoViewCalls(page: Page, on: string) {
  return await page.evaluate((id) => {
    const calls = (window as unknown as { __sivCalls?: { on: string }[] }).__sivCalls ?? [];
    return calls.filter((c) => c.on === id);
  }, on);
}

/**
 * Which realm's constructors built each part of the editing surface.
 *
 * The iframe's document has TWO populations of nodes and they do not share a
 * realm: the shell (`<html>`, `<body>`, the report's and the editor's
 * `<style>`) is parsed by the IFRAME's own HTML parser from `srcdoc`, while
 * every node carrying report content — and therefore every anchor `id` a TOC
 * link points at — is built by ProseMirror, which runs in the PARENT window
 * and calls the PARENT document's `createElement`. Appending those nodes
 * ADOPTS them (their `ownerDocument` becomes the iframe's), but adoption does
 * not re-wrap them: they keep the parent realm's prototypes for life.
 */
async function readAnchorRealm(page: Page, targetId: string) {
  return await page.evaluate((id) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow;
    if (!doc || !win) throw new Error("the editing surface has not mounted");
    const iframeElement = (win as unknown as { Element: typeof Element }).Element;
    const target = doc.getElementById(id);
    const style = doc.querySelector("style");
    if (!target || !style) throw new Error(`the editing surface has no #${id} / no <style>`);
    const realmOf = (node: Element) => ({
      iframeRealm: node instanceof iframeElement,
      parentRealm: node instanceof Element,
    });
    return {
      // Parsed by the iframe from `srcdoc`.
      documentElement: realmOf(doc.documentElement),
      body: realmOf(doc.body),
      style: realmOf(style),
      // Rendered by ProseMirror, from the parent window.
      anchorTarget: realmOf(target),
      anchorTargetOwnerIsIframeDoc: target.ownerDocument === doc,
      // The two realms really are distinct — otherwise the readings above
      // would be trivially true and prove nothing.
      realmsAreDistinct: (iframeElement as unknown) !== (Element as unknown),
    };
  }, targetId);
}

/**
 * THE REPORT DOCUMENTS THIS CONTRACT RUNS AGAINST, and the selectors each one
 * offers.
 *
 * The two SYNTHETIC fixtures differ in exactly one respect — whether the
 * report's own stylesheet sets `scroll-behavior` — for the reason in this
 * file's header. The third is the REAL generated report, verbatim, and it is
 * here because ADR-0079's rule ("a fixture may be smaller than a real report,
 * never different IN KIND") had already been broken twice by the time it was
 * written down, and prose plus a text-scanning fidelity test (harness/
 * fixture-fidelity.test.ts) can only ever catch declarations that are MISSING.
 * They cannot catch a DOM that is shaped differently, content lengths that are
 * two orders of magnitude apart, or an anchor sitting 973px down a 20,000px
 * document rather than 1,100px down a 3,000px one. Running the same contracts
 * over the real thing can.
 *
 * Every selector is per-fixture rather than hard-coded, because the real report
 * shares none of the synthetic ids: it is a `#summary`/`#how`/`#roles` document
 * with a nine-entry TOC, and pretending otherwise would mean quietly narrowing
 * the second project to whatever happened to match.
 */
type ReportFixture = {
  /** Path, relative to `harness/`, of the report to mount. */
  readonly file: string;
  readonly label: string;
  /** Playwright tag selecting which PROJECT runs this fixture — the second
   *  project (`real-report`) is what makes "the same specs, over a real
   *  report" a thing CI enforces rather than a thing someone remembers. */
  readonly tag: string;
  /** Whether this fixture's own stylesheet sets `scroll-behavior: smooth`.
   *  Only a smooth one can assert that the editor's injected override wins the
   *  cascade — on the others there is nothing to override. */
  readonly asksForSmooth: boolean;
  /** An id on a `<section>` that is BELOW THE FOLD at rest and has enough
   *  document below it that top-aligning it is reachable. Both are premises of
   *  `expectAnchorRevealed`, which asserts them rather than assuming them. */
  readonly sectionAnchor: string;
  /** An id on a HEADING rather than a section, or `null` when the fixture has
   *  none. The real generated report puts EVERY anchor id on a `<section>`
   *  (all nine of them), so there is no heading-id case to run there — the
   *  contract is therefore not registered for that fixture at all, rather than
   *  registered-and-skipped. Heading ids stay covered by the synthetic pair. */
  readonly headingAnchor: string | null;
  /** An absolute external link that is ON SCREEN at rest, so it can be clicked
   *  without first scrolling (which would perturb the state under test). */
  readonly externalHref: string;
  /** A prose paragraph that is ON SCREEN at rest, for the comment leg. */
  readonly commentParagraph: string;
};

const FIXTURES: readonly ReportFixture[] = [
  {
    file: "report.html",
    label: "a report whose CSS asks for smooth scrolling",
    tag: "@synthetic-fixture",
    asksForSmooth: true,
    sectionAnchor: "deep-section",
    headingAnchor: "section-two",
    externalHref: "https://example.com/",
    commentParagraph: "#filler p",
  },
  {
    file: "plain-report.html",
    label: "a report with no scroll-behavior at all (the measured production document)",
    tag: "@synthetic-fixture",
    asksForSmooth: false,
    sectionAnchor: "deep-section",
    headingAnchor: "section-two",
    externalHref: "https://example.com/",
    commentParagraph: "#filler p",
  },
  {
    // The same 86KB document `fixture-fidelity.test.ts` scans, and the same one
    // editor-auth.feature uploads to a real preview — so the three tiers now
    // agree on what "a report" means.
    file: "../../../packages/report-html/src/fixtures/ai-readiness-report.html",
    label: "the REAL generated report, verbatim (ADR-0079 fidelity)",
    tag: "@real-report",
    // `html { scroll-behavior: smooth }` — this is the document that rule was
    // copied INTO the synthetic fixture from.
    asksForSmooth: true,
    // 973px down a 20,828px-scrollable document, against a 647px surface: below
    // the fold with ~20,000px of runway, and `section { scroll-margin-top: 1rem }`
    // applies to it — which is exactly the 16px landing offset a hard-coded
    // "top means zero" assertion would have got wrong.
    sectionAnchor: "summary",
    headingAnchor: null,
    externalHref: "https://uk.linkedin.com/in/agranado2k",
    commentParagraph: "p.sub",
  },
];

for (const fixture of FIXTURES) {
  test.describe(`in-page anchor links in the editor — ${fixture.label}`, {
    tag: fixture.tag,
  }, () => {
    let harnessPage: string;
    const anchor = fixture.sectionAnchor;

    test.beforeAll(async () => {
      harnessPage = await buildHarness(fixture.file);
    });

    test.beforeEach(async ({ page }) => {
      await page.goto(`file://${harnessPage}`);
      // The editor mounts in a client effect once the srcdoc iframe has loaded.
      await expect
        .poll(async () =>
          page.evaluate(
            (href) =>
              (
                document.querySelector("iframe") as HTMLIFrameElement
              )?.contentDocument?.querySelector(`a[href="${href}"]`) !== null,
            `#${anchor}`,
          ),
        )
        .toBe(true);
    });

    test("clicking a fragment link scrolls the editing surface to that section", async ({
      page,
    }) => {
      const before = await readEditorScroll(page, anchor);
      expect(before.scrollY).toBe(0);

      await clickLinkInEditor(page, `#${anchor}`);

      await expectAnchorRevealed(page, anchor, before);
    });

    // Registered only for fixtures that HAVE a heading id. The real generated
    // report puts all nine of its anchor ids on `<section>` elements, so this
    // contract has no subject there — an explicit non-registration, not a
    // silent narrowing (the reason is on `headingAnchor` in the table above).
    if (fixture.headingAnchor) {
      const headingAnchor = fixture.headingAnchor;
      test("an id on a heading scrolls too, not just an id on a section", async ({ page }) => {
        const before = await readEditorScroll(page, headingAnchor);

        await clickLinkInEditor(page, `#${headingAnchor}`);

        await expectAnchorRevealed(page, headingAnchor, before);
      });
    }

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
      const before = await readEditorScroll(page, anchor);
      expect(before.scrollY).toBe(0);

      await clickLinkInEditor(page, `#${anchor}`);

      await expectAnchorRevealed(page, anchor, before);
    });

    // THE ONE ASSERTION IN THIS FILE THAT IS ABOUT THE CALL RATHER THAN THE
    // OUTCOME. It is here because a final-offset assertion cannot tell "the
    // top-alignment pass ran" from "something else left the surface at the
    // right offset", and because the production instrumentation that reported
    // this pass missing was patching a prototype the call never goes through
    // (`armScrollIntoViewSpy`). Exactly one call, on the anchor, instant and
    // top-aligned — and the iframe realm records none of it.
    test("the top-alignment pass really calls scrollIntoView on the anchor", async ({ page }) => {
      await armScrollIntoViewSpy(page);

      await clickLinkInEditor(page, `#${anchor}`);

      await expect
        .poll(async () => await readScrollIntoViewCalls(page, `section#${anchor}`), {
          timeout: ARRIVAL_MS,
        })
        .toEqual([
          {
            realm: "parent",
            on: `section#${anchor}`,
            args: JSON.stringify([{ behavior: "instant", block: "start" }]),
          },
        ]);

      // And it STAYS one call: the pass is not re-issued by a later render.
      await page.waitForTimeout(HOLD_MS);
      expect(await readScrollIntoViewCalls(page, `section#${anchor}`)).toHaveLength(1);
    });

    // THE TWO CONTRACTS ROUND FIVE ADDED, and why they are contracts rather
    // than another theory.
    //
    // The operator's round-five production trace — taken with the spy on BOTH
    // prototypes, including the parent one the call actually resolves through
    // — reads, for a real mouse click on a TOC link on the live `/edit` page:
    //
    //     caretHost:    "H2#section-two"
    //     trace:        [ { kind: "scrollBy", args: "[0,77.9453125]", y: 0 } ]
    //     finalScrollY: 78      targetTop: 609 (was 687)
    //
    // Run against this harness's `plain-report.html`, the same instrumentation
    // reads clientHeight 647, `#section-two` documentTop 687 and
    // `scrollBy(0, 77.90625)` — the caret transaction and ProseMirror's own
    // minimal reveal are byte-for-byte the same in both places. The ONLY
    // difference is the entry the production trace does not have:
    // `scrollIntoView` on the anchor. So the divergence lives entirely in the
    // few lines between `view.dispatch(...)` returning and the alignment pass
    // issuing its scroll, and the two tests below state, as contracts, that
    // nothing in that gap may be load-bearing:
    //
    //   - it must not need a later animation frame, and
    //   - it must not be reachable only when everything before it succeeded.
    //
    // NEITHER TEST REPRODUCES THE PRODUCTION FAILURE, and neither claims to
    // identify its cause — the cause is still not established. They fail
    // against the pre-round-five design for the right structural reason, and
    // they remove two of the three unobserved ways the pass could be skipped
    // without leaving a trace. Read them as the removal of a failure surface,
    // not as a diagnosis.
    test("the anchor jump does not depend on a later animation frame", async ({ page }) => {
      // Every subsequent frame request on the PARENT window — the window the
      // click handler runs in — is recorded and never invoked. A jump that
      // still lands owes nothing to the frame; a jump that stalls at
      // ProseMirror's minimal reveal was waiting on one.
      await page.evaluate(() => {
        (window as unknown as { __rafRequests: number }).__rafRequests = 0;
        window.requestAnimationFrame = () => {
          (window as unknown as { __rafRequests: number }).__rafRequests += 1;
          return 0;
        };
      });
      const before = await readEditorScroll(page, anchor);
      expect(before.scrollY).toBe(0);

      await clickLinkInEditor(page, `#${anchor}`);

      await expectAnchorRevealed(page, anchor, before);
    });

    test("the anchor jump survives a caller callback that throws mid-dispatch", async ({
      page,
    }) => {
      // `onSelectionChange` is invoked from inside `view.dispatch(...)`, which
      // the anchor click makes from inside its own `handleDOMEvents.click`
      // handler — and prosemirror-view puts no try/catch around such a
      // handler. Arming the harness's callback to throw therefore aborts the
      // click handler at exactly the point the production trace stops:
      // ProseMirror has applied the caret and issued its `scrollBy`, and
      // whatever the handler had left to do does not run.
      await page.evaluate(() => {
        (window as unknown as { __throwOnSelectionChange: boolean }).__throwOnSelectionChange =
          true;
      });
      const before = await readEditorScroll(page, anchor);
      expect(before.scrollY).toBe(0);

      await clickLinkInEditor(page, `#${anchor}`);

      await expectAnchorRevealed(page, anchor, before);
    });

    // THE REALM FACT, PINNED, because getting it backwards cost three rounds of
    // investigation: a production trace instrumented the iframe's
    // `Element.prototype`, saw nothing, and concluded the top-alignment pass
    // never executes. It executes; that prototype is simply not on its lookup
    // path. This test is what makes the next instrumentation land in the right
    // realm — and it fails loudly if a future ProseMirror ever starts rendering
    // through the iframe's own `createElement`, which would move the path.
    test("ProseMirror renders the report with the PARENT realm's constructors", async ({
      page,
    }) => {
      const realm = await readAnchorRealm(page, anchor);

      expect(realm.realmsAreDistinct).toBe(true);
      // The shell — parsed by the iframe itself from `srcdoc`.
      expect(realm.documentElement).toEqual({ iframeRealm: true, parentRealm: false });
      expect(realm.body).toEqual({ iframeRealm: true, parentRealm: false });
      expect(realm.style).toEqual({ iframeRealm: true, parentRealm: false });
      // The report — rendered by ProseMirror from the parent window, then
      // adopted into the iframe's document without being re-wrapped.
      expect(realm.anchorTarget).toEqual({ iframeRealm: false, parentRealm: true });
      expect(realm.anchorTargetOwnerIsIframeDoc).toBe(true);
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

      await clickLinkInEditor(page, fixture.externalHref);

      await expect
        .poll(async () =>
          page.evaluate(() => (window as unknown as { __opened: string[] }).__opened),
        )
        .toEqual([fixture.externalHref]);
      // And the surface stayed put — asserted after the same hold window the
      // anchor cases use, so a late scroll would be seen rather than slept
      // through.
      await page.waitForTimeout(HOLD_MS);
      expect((await readEditorScroll(page, anchor)).scrollY).toBe(0);
    });

    test("Alt+click suppresses activation so the link text stays editable", async ({ page }) => {
      const point = await linkPoint(page, `#${anchor}`);
      await page.keyboard.down("Alt");
      await page.mouse.click(point.x, point.y);
      await page.keyboard.up("Alt");

      await page.waitForTimeout(HOLD_MS);
      expect((await readEditorScroll(page, anchor)).scrollY).toBe(0);
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
      const paragraph = await elementBox(page, fixture.commentParagraph);
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

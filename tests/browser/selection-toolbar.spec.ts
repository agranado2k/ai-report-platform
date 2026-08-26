// BROWSER coverage for the Selection toolbar (ticket #296; the tier is
// ADR-0079). The toolbar's decision logic is pure and node-tested
// (toolbar-placement.test.ts, selection-rect.test.ts) — what only this tier
// can see is the seam those functions cross: ProseMirror coordinates leaving
// a sandboxed iframe, real mouse selection input, scroll events that produce
// no PM transaction, and Escape pressed inside a document the host window
// never hears from. Every contract runs over the synthetic fixtures AND the
// real generated report, same as anchor-scroll.spec.ts.
//
// THE SELECTION GESTURE HERE IS DOUBLE-CLICK (word selection), NOT A
// HELD-BUTTON DRAG. Not a stylistic choice: a CDP-synthetic `mouse.move`
// with the button held wedges this harness's renderer outright — verified
// against pristine HEAD with no toolbar code at all, so it is a pre-existing
// property of Chrome + the sandboxed-srcdoc editing iframe under synthetic
// input (the same environment quirk documented on ReportEditor's
// `handleDOMEvents`: Chrome synthesizes `buttons === 0` mousemoves inside
// this iframe that kill PM's own MouseDown tracker). Real user drags are fine
// in production; this tier simply cannot drive one. Double-click is the same
// real-input gesture anchor-scroll.spec.ts already relies on, and it
// exercises the seam end-to-end: real input → PM selection → geometry out of
// the iframe → placed toolbar. Two honesty notes, measured not assumed:
// in THIS environment the word selection lands only after the release (the
// same tracker quirk), so the geometry these contracts see comes off the
// DISPATCH path — the `mouseup` re-report in ReportEditor exists for real
// drags, whose final selection transaction fires before the release, and is
// NOT exercised by any tier (deleting it keeps this suite green; it is
// production-drag-only code, guarded by the node-tier gate tests instead).
// Likewise the mid-drag "geometry withheld while the pointer is down" gate
// is not observable here — it is pinned at the node tier
// (`shouldComputeGeometry`, selection-rect.test.ts). Revisit both if this
// harness ever gains real drags.
import { expect, test } from "@playwright/test";
import { buildHarness } from "./harness/build.mjs";

type Page = import("@playwright/test").Page;

type ToolbarFixture = {
  /** Path, relative to `harness/`, of the report to mount. */
  readonly file: string;
  readonly label: string;
  /** Playwright tag selecting which PROJECT runs this fixture. */
  readonly tag: string;
  /** A prose paragraph that is ON SCREEN at rest, with a double-clickable
   *  word near its start. */
  readonly paragraph: string;
};

const FIXTURES: readonly ToolbarFixture[] = [
  {
    file: "report.html",
    label: "a report whose CSS asks for smooth scrolling",
    tag: "@synthetic-fixture",
    paragraph: "#filler p",
  },
  {
    file: "plain-report.html",
    label: "a report with no scroll-behavior at all (the measured production document)",
    tag: "@synthetic-fixture",
    paragraph: "#filler p",
  },
  {
    file: "../../../packages/report-html/src/fixtures/ai-readiness-report.html",
    label: "the REAL generated report, verbatim (ADR-0079 fidelity)",
    tag: "@real-report",
    paragraph: "p.sub",
  },
];

/** An element's rect translated into HOST viewport coordinates (element rect
 *  in the iframe's space + the iframe's own offset) — the space Playwright's
 *  mouse and the toolbar's fixed positioning both live in. Throws on a
 *  missing surface/element rather than returning sentinel numbers. */
async function hostRect(page: Page, selector: string) {
  return await page.evaluate((sel) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error("the editing surface has not mounted");
    const el = doc.querySelector(sel);
    if (!el) throw new Error(`the editing surface has no ${sel}`);
    const frame = iframe.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return {
      x: frame.left + rect.left,
      y: frame.top + rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, selector);
}

/** Select a word in `selector`'s first line with real mouse input (double
 *  click — see the file doc comment for why not a drag), returning where the
 *  gesture happened (host coordinates). */
async function selectWord(page: Page, selector: string) {
  const rect = await hostRect(page, selector);
  const x = rect.x + 10;
  const y = rect.y + Math.min(10, rect.height / 2);
  await page.mouse.dblclick(x, y);
  return { x, y };
}

/** The harness's reported (trimmed) selection text — the word the formatting
 *  contracts below expect to see wrapped in a mark element. */
async function selectedWord(page: Page): Promise<string> {
  const text = ((await page.getByTestId("pending-selection").textContent()) ?? "").trim();
  if (text.length === 0) throw new Error("no selection is pending");
  return text;
}

/** How many `<tag>` elements in the editing iframe contain `word`. Counted
 *  (not just "exists") because a real report legitimately carries its own
 *  `<strong>`/`<em>` content — the contracts assert the count GREW. */
async function markCount(page: Page, tag: string, word: string): Promise<number> {
  return await page.evaluate(
    ({ tag, word }) => {
      const doc = (document.querySelector("iframe") as HTMLIFrameElement)?.contentDocument;
      if (!doc) throw new Error("the editing surface has not mounted");
      return Array.from(doc.querySelectorAll(tag)).filter((el) =>
        (el.textContent ?? "").includes(word),
      ).length;
    },
    { tag, word },
  );
}

for (const fixture of FIXTURES) {
  test.describe(`the Selection toolbar — ${fixture.label}`, { tag: fixture.tag }, () => {
    let harnessPage: string;

    test.beforeAll(async () => {
      harnessPage = await buildHarness(fixture.file);
    });

    test.beforeEach(async ({ page }) => {
      await page.goto(`file://${harnessPage}`);
      // The editor mounts in a client effect once the srcdoc iframe has
      // loaded — the paragraph under test becoming reachable is the signal.
      await expect
        .poll(async () =>
          page.evaluate(
            (sel) =>
              (
                document.querySelector("iframe") as HTMLIFrameElement
              )?.contentDocument?.querySelector(sel) !== null,
            fixture.paragraph,
          ),
        )
        .toBe(true);
    });

    test("a real mouse selection shows the toolbar above it, inside the viewport", async ({
      page,
    }) => {
      const gesture = await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();
      expect((await page.getByTestId("pending-selection").textContent())?.length).toBeGreaterThan(
        0,
      );

      // Above the selected line, fully inside the viewport.
      await expect(toolbar).toHaveAttribute("data-placement", "above");
      const box = await toolbar.boundingBox();
      if (!box) throw new Error("the toolbar has no box");
      expect(box.y + box.height).toBeLessThanOrEqual(gesture.y);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
    });

    test("flips below when the selection sits at the top of the surface", async ({ page }) => {
      // Scroll the paragraph to the very top edge of the editing surface,
      // so there is no room above it for the bar.
      await page.evaluate((sel) => {
        const iframe = document.querySelector("iframe") as HTMLIFrameElement;
        const doc = iframe.contentDocument;
        const win = iframe.contentWindow;
        if (!doc || !win) throw new Error("the editing surface has not mounted");
        const el = doc.querySelector(sel);
        if (!el) throw new Error(`the editing surface has no ${sel}`);
        win.scrollTo(0, win.scrollY + el.getBoundingClientRect().top);
      }, fixture.paragraph);

      const gesture = await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();
      await expect(toolbar).toHaveAttribute("data-placement", "below");
      const box = await toolbar.boundingBox();
      if (!box) throw new Error("the toolbar has no box");
      expect(box.y).toBeGreaterThanOrEqual(gesture.y);
    });

    test("collapsing the selection hides the toolbar", async ({ page }) => {
      await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();

      const rect = await hostRect(page, fixture.paragraph);
      await page.mouse.click(rect.x + rect.width - 10, rect.y + Math.min(10, rect.height / 2));
      await expect(toolbar).toHaveCount(0);
    });

    test("Escape hides the toolbar and keeps the selection", async ({ page }) => {
      await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(toolbar).toHaveCount(0);
      // The selection itself survives — Escape dismisses chrome, not intent.
      expect((await page.getByTestId("pending-selection").textContent())?.length).toBeGreaterThan(
        0,
      );
    });

    test("scrolling the document hides the toolbar instead of letting it drift", async ({
      page,
    }) => {
      const gesture = await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();

      await page.mouse.move(gesture.x, gesture.y + 60);
      await page.mouse.wheel(0, 120);
      await expect(toolbar).toHaveCount(0);
    });

    test("a programmatic selection (Jump) reveals without showing the toolbar", async ({
      page,
    }) => {
      // A real selection first, turned into a comment the Jump can target.
      await selectWord(page, fixture.paragraph);
      await page.getByTestId("add-comment").click();
      // Collapse it so nothing is pending.
      const rect = await hostRect(page, fixture.paragraph);
      await page.mouse.click(rect.x + rect.width - 10, rect.y + Math.min(10, rect.height / 2));
      await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);

      await page.getByTestId("jump-to-comment").click();
      // The jump DID move the editor's selection onto the anchored range…
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const doc = (document.querySelector("iframe") as HTMLIFrameElement)?.contentDocument;
            const sel = doc?.getSelection();
            return sel !== null && sel !== undefined && !sel.isCollapsed;
          }),
        )
        .toBe(true);
      // …and neither the toolbar nor the pending (composer-feeding) selection
      // may react to it: revealing must never open authoring chrome.
      await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);
      await expect(page.getByTestId("pending-selection")).toHaveText("");
    });

    test("clicking inside the toolbar keeps the selection and the toolbar", async ({ page }) => {
      await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();
      const before = await page.getByTestId("pending-selection").textContent();
      expect(before?.length).toBeGreaterThan(0);

      await toolbar.getByRole("button", { name: "Bold" }).click();
      await expect(toolbar).toBeVisible();
      await expect(page.getByTestId("pending-selection")).toHaveText(before ?? "");
      // The load-bearing observation is INSIDE the iframe (claude-review
      // #301 H-5): host React state cannot change when the iframe blurs (no
      // PM transaction fires), so only the iframe's own DOM selection can
      // prove the mousedown-preventDefault kept the real selection alive.
      // Deleting that preventDefault must fail THIS line.
      const iframeSelection = await page.evaluate(() => {
        const doc = (document.querySelector("iframe") as HTMLIFrameElement)?.contentDocument;
        const sel = doc?.getSelection();
        return { exists: sel !== null && sel !== undefined, collapsed: sel?.isCollapsed ?? true };
      });
      expect(iframeSelection.exists).toBe(true);
      expect(iframeSelection.collapsed).toBe(false);
    });

    // ── Formatting toggles (ticket #297) ────────────────────────────────────

    test("the Bold button bolds the selection in the document and shows pressed", async ({
      page,
    }) => {
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      const toolbar = page.getByTestId("selection-toolbar");
      const bold = toolbar.getByRole("button", { name: "Bold" });
      await expect(bold).toHaveAttribute("aria-pressed", "false");
      const before = await markCount(page, "strong", word);

      await bold.click();

      // Active state updates live, the document really carries the mark
      // (observed in the iframe's own DOM), and the toolbar stays up.
      await expect(bold).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => markCount(page, "strong", word)).toBeGreaterThan(before);
      await expect(toolbar).toBeVisible();
    });

    test("bold then italic chain on the same selection without re-selecting", async ({ page }) => {
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      const toolbar = page.getByTestId("selection-toolbar");
      const bold = toolbar.getByRole("button", { name: "Bold" });
      const italic = toolbar.getByRole("button", { name: "Italic" });
      const strongBefore = await markCount(page, "strong", word);
      const emBefore = await markCount(page, "em", word);

      await bold.click();
      await italic.click();

      await expect(bold).toHaveAttribute("aria-pressed", "true");
      await expect(italic).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => markCount(page, "strong", word)).toBeGreaterThan(strongBefore);
      await expect.poll(() => markCount(page, "em", word)).toBeGreaterThan(emBefore);

      // The chain worked because the selection survived BOTH toggles — the
      // iframe's own DOM selection is the authority (same reasoning as the
      // "clicking inside the toolbar" contract above).
      const iframeSelection = await page.evaluate(() => {
        const doc = (document.querySelector("iframe") as HTMLIFrameElement)?.contentDocument;
        const sel = doc?.getSelection();
        return { exists: sel !== null && sel !== undefined, collapsed: sel?.isCollapsed ?? true };
      });
      expect(iframeSelection.exists).toBe(true);
      expect(iframeSelection.collapsed).toBe(false);
    });

    test("re-selecting already-bold text arrives with Bold already pressed", async ({ page }) => {
      // Make the word bold via the toolbar, then collapse the selection away.
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      await page.getByTestId("selection-toolbar").getByRole("button", { name: "Bold" }).click();
      await expect.poll(() => markCount(page, "strong", word)).toBeGreaterThan(0);
      const rect = await hostRect(page, fixture.paragraph);
      await page.mouse.click(rect.x + rect.width - 10, rect.y + Math.min(10, rect.height / 2));
      await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);

      // Arriving on already-bold text shows Bold active immediately.
      await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(toolbar.getByRole("button", { name: "Italic" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    test("a keyboard-extended selection shows the toolbar too", async ({ page }) => {
      // Caret in the paragraph, then Shift+ArrowRight — selection built by
      // TRANSACTIONS with no pointer involved. This is the dispatch-path
      // geometry report (dragging=false) observed end-to-end, and it guards
      // the drag flag against getting stuck: a wedged-true flag would
      // withhold geometry from exactly this gesture.
      const rect = await hostRect(page, fixture.paragraph);
      await page.mouse.click(rect.x + 10, rect.y + Math.min(10, rect.height / 2));
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Shift+ArrowRight");
      }
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();
      expect((await page.getByTestId("pending-selection").textContent())?.length).toBeGreaterThan(
        0,
      );
    });
  });
}

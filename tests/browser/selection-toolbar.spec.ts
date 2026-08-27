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
 *  contracts below expect to see wrapped in a mark element. Polled: in this
 *  environment the word selection lands only after the release (file doc
 *  comment), and the harness's React state update trails the gesture by a
 *  frame or two — reading synchronously flakes under load. */
async function selectedWord(page: Page): Promise<string> {
  const read = async () =>
    ((await page.getByTestId("pending-selection").textContent()) ?? "").trim();
  await expect.poll(async () => (await read()).length, { timeout: 5_000 }).toBeGreaterThan(0);
  return await read();
}

/** Select a word INSIDE AN EXISTING LINK: the same double-click gesture as
 *  `selectWord`, with Alt held — the editor's own "suppress activation so the
 *  link can be edited" escape hatch (link-activation.ts). Without Alt, each of
 *  the double-click's TWO click events would activate the link and open a tab
 *  (Amendment 3's plain-click-follows behavior), which is exactly not the
 *  edit gesture. */
async function altSelectWord(page: Page, selector: string) {
  const rect = await hostRect(page, selector);
  const x = rect.x + 10;
  const y = rect.y + Math.min(10, rect.height / 2);
  // Bounded retry: under synthetic input this iframe occasionally registers
  // the double-click as two caret placements (the same environment quirk the
  // file doc comment documents for drags), leaving no word selection at all.
  // Retrying the GESTURE is safe — every caller still asserts the outcome
  // (toolbar contents, document state) after this returns.
  for (let attempt = 0; ; attempt += 1) {
    await page.keyboard.down("Alt");
    await page.mouse.dblclick(x, y);
    await page.keyboard.up("Alt");
    try {
      await expect(page.getByTestId("selection-toolbar")).toBeVisible({ timeout: 2_000 });
      return { x, y };
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

/** Every `<a>` in the editing iframe carrying EXACTLY `href`, with the attrs
 *  the link contracts assert on. Matching on the test's own unique href (not
 *  text) keeps the real-report fixture's legitimate links out of the count. */
async function anchorsWithHref(
  page: Page,
  href: string,
): Promise<ReadonlyArray<{ text: string; target: string | null; rel: string | null }>> {
  return await page.evaluate((h) => {
    const doc = (document.querySelector("iframe") as HTMLIFrameElement)?.contentDocument;
    if (!doc) throw new Error("the editing surface has not mounted");
    return Array.from(doc.querySelectorAll("a"))
      .filter((a) => a.getAttribute("href") === h)
      .map((a) => ({
        text: a.textContent ?? "",
        target: a.getAttribute("target"),
        rel: a.getAttribute("rel"),
      }));
  }, href);
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

    // ── Link editing (ticket #299) ──────────────────────────────────────────

    // Unique per-suite href so the real-report fixture's own links never
    // collide with what these contracts create.
    const ADDED_HREF = "https://example.com/added-by-toolbar-test";

    /** Select the fixture word and turn it into ADDED_HREF via the toolbar's
     *  link editor — the shared setup for the edit/remove contracts. */
    async function createLink(page: Page): Promise<string> {
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      await page.getByTestId("selection-toolbar").getByRole("button", { name: "Link" }).click();
      const input = page.getByTestId("link-url-input");
      await input.click();
      await page.keyboard.type(ADDED_HREF);
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await anchorsWithHref(page, ADDED_HREF)).length).toBe(1);
      return word;
    }

    test("Link → type URL → Enter links the selected word with the safe attrs and shows pressed", async ({
      page,
    }) => {
      // The typing happens with host focus in the URL input — the iframe is
      // blurred, its visual selection hidden — and the apply must still land
      // on the range that WAS selected (PM's state selection persists).
      const word = await createLink(page);

      const [anchor] = await anchorsWithHref(page, ADDED_HREF);
      if (!anchor) throw new Error("the applied link is missing");
      expect(anchor.text).toContain(word);
      // Nothing beyond the typed href: no target/rel smuggled onto a link
      // the user created (the schema adds those only when a source document
      // carried them).
      expect(anchor.target).toBeNull();
      expect(anchor.rel).toBeNull();

      // The bar swapped back to its buttons, still up, with Link pressed.
      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Link" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    test("an unsafe javascript: URL is rejected with visible feedback and the document unchanged", async ({
      page,
    }) => {
      await selectWord(page, fixture.paragraph);
      await page.getByTestId("selection-toolbar").getByRole("button", { name: "Link" }).click();
      const input = page.getByTestId("link-url-input");
      await input.click();
      await page.keyboard.type("javascript:alert(1)");
      await page.keyboard.press("Enter");

      // Visible inline feedback, and the editor stays open for correction.
      await expect(page.getByTestId("link-url-error")).toBeVisible();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toBeVisible();

      // The document is untouched: no anchor carries the rejected href.
      expect((await anchorsWithHref(page, "javascript:alert(1)")).length).toBe(0);
    });

    test("re-selecting inside the link shows pressed and pre-fills the editor with its href", async ({
      page,
    }) => {
      await createLink(page);

      // Collapse the selection away, then arrive back INSIDE the link
      // (Alt-select — a plain double-click would follow the link).
      const rect = await hostRect(page, fixture.paragraph);
      await page.mouse.click(rect.x + rect.width - 10, rect.y + Math.min(10, rect.height / 2));
      await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);
      await altSelectWord(page, fixture.paragraph);

      const toolbar = page.getByTestId("selection-toolbar");
      await expect(toolbar).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Link" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await toolbar.getByRole("button", { name: "Link" }).click();
      await expect(page.getByTestId("link-url-input")).toHaveValue(ADDED_HREF);
    });

    test("Remove strips the whole link; the text survives unlinked", async ({ page }) => {
      const word = await createLink(page);

      // Selection is still on the linked word (applyLink refocused the
      // editor); open the editor again and remove.
      const toolbar = page.getByTestId("selection-toolbar");
      await toolbar.getByRole("button", { name: "Link" }).click();
      await toolbar.getByRole("button", { name: "Remove link" }).click();

      await expect.poll(async () => (await anchorsWithHref(page, ADDED_HREF)).length).toBe(0);
      // The text itself survives, unlinked, and the button reads unpressed.
      expect(await markCount(page, "p", word)).toBeGreaterThan(0);
      await expect(toolbar.getByRole("button", { name: "Link" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    test("editing an existing link's URL applies the CHANGED href to the document", async ({
      page,
    }) => {
      // #299 AC4's edit half: not just pre-filling the old value (covered
      // above) but typing a DIFFERENT URL and applying it — the iframe's <a>
      // must carry the new href, and only the new one.
      const EDITED_HREF = "https://example.com/edited-by-toolbar-test";
      const word = await createLink(page);

      // Arrive back inside the link and open the editor: pre-filled and
      // fully selected, so typing replaces the old value.
      const rect = await hostRect(page, fixture.paragraph);
      await page.mouse.click(rect.x + rect.width - 10, rect.y + Math.min(10, rect.height / 2));
      await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);
      await altSelectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await toolbar.getByRole("button", { name: "Link" }).click();
      await expect(page.getByTestId("link-url-input")).toHaveValue(ADDED_HREF);

      await page.keyboard.type(EDITED_HREF);
      await page.keyboard.press("Enter");

      // The document's anchor updated in place: new href present around the
      // same word, old href gone.
      await expect.poll(async () => (await anchorsWithHref(page, EDITED_HREF)).length).toBe(1);
      expect((await anchorsWithHref(page, ADDED_HREF)).length).toBe(0);
      const [anchor] = await anchorsWithHref(page, EDITED_HREF);
      expect(anchor?.text).toContain(word);
    });

    test("Apply and Remove both hand focus back to the editor iframe", async ({ page }) => {
      // The URL input took real keyboard focus (the one deliberate exception
      // to "the bar never takes focus"), so applyLink/removeLink must RETURN
      // it: `view.focus()` on the handle is what re-focuses the iframe and
      // re-reveals the selection. Without it, focus falls to document.body
      // when the link editor unmounts.
      const hostFocus = () =>
        page.evaluate(() => ({
          tag: document.activeElement?.tagName ?? null,
          innerHasFocus:
            (
              document.querySelector("iframe") as HTMLIFrameElement | null
            )?.contentDocument?.hasFocus() ?? false,
        }));

      await createLink(page); // ends with Enter → applyLink
      await expect.poll(async () => (await hostFocus()).tag).toBe("IFRAME");
      expect((await hostFocus()).innerHasFocus).toBe(true);

      // Now the remove path: reopen the editor (focus moves into the URL
      // input again) and click Remove.
      const toolbar = page.getByTestId("selection-toolbar");
      await toolbar.getByRole("button", { name: "Link" }).click();
      await expect(page.getByTestId("link-url-input")).toBeFocused();
      await toolbar.getByRole("button", { name: "Remove link" }).click();

      await expect.poll(async () => (await hostFocus()).tag).toBe("IFRAME");
      expect((await hostFocus()).innerHasFocus).toBe(true);
    });

    test("a mid-value click in the URL input places the caret — the input is genuinely interactive", async ({
      page,
    }) => {
      // The container's mousedown-preventDefault protects the iframe's
      // selection; the input's own mousedown stops propagation so the input
      // still behaves like an input. Autofocus masks that handler for the
      // FIRST interaction, so this contract clicks mid-value: the caret must
      // land (collapsing the pre-fill's select-all) and typing must INSERT,
      // not replace the whole value.
      await createLink(page);
      const rect = await hostRect(page, fixture.paragraph);
      await page.mouse.click(rect.x + rect.width - 10, rect.y + Math.min(10, rect.height / 2));
      await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);
      await altSelectWord(page, fixture.paragraph);
      await page.getByTestId("selection-toolbar").getByRole("button", { name: "Link" }).click();

      const input = page.getByTestId("link-url-input");
      await expect(input).toHaveValue(ADDED_HREF);
      // The pre-fill starts fully selected (the type-to-replace affordance).
      await expect
        .poll(() =>
          input.evaluate(
            (el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0),
          ),
        )
        .toBe(ADDED_HREF.length);

      await input.click(); // center of the input — mid-value

      // The click collapsed the selection to a caret INSIDE the value…
      const caret = await input.evaluate((el: HTMLInputElement) => ({
        start: el.selectionStart,
        end: el.selectionEnd,
      }));
      expect(caret.start).toBe(caret.end);
      expect(caret.start ?? 0).toBeGreaterThan(0);

      // …so typing inserts at the caret instead of replacing everything.
      await page.keyboard.type("x");
      const value = await input.inputValue();
      expect(value).toHaveLength(ADDED_HREF.length + 1);
      expect(value).not.toBe("x");
    });

    test("Cancel closes the link editor, keeping the bar and the selection", async ({ page }) => {
      // The CLICK path out of the editor (distinct from the Escape path
      // below): same outcome — back to the button row, selection intact.
      await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await toolbar.getByRole("button", { name: "Link" }).click();
      const input = page.getByTestId("link-url-input");
      await expect(input).toBeVisible();

      await toolbar.getByRole("button", { name: "Cancel link" }).click();

      await expect(input).toHaveCount(0);
      await expect(toolbar).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Bold" })).toBeVisible();
      expect((await page.getByTestId("pending-selection").textContent())?.length).toBeGreaterThan(
        0,
      );
    });

    test("the bar stays correctly placed while the link editor (and its error line) is open", async ({
      page,
    }) => {
      // The re-measure effect's contract (keyed on linkOpen/linkError): the
      // open editor — and the taller open-with-error state — is re-measured
      // and re-placed, so the bar still clears the selected line and stays
      // inside the viewport. A stale closed-state measurement would park the
      // taller bar overlapping the very line it annotates.
      const gesture = await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await toolbar.getByRole("button", { name: "Link" }).click();
      await expect(page.getByTestId("link-url-input")).toBeVisible();

      await expect(toolbar).toHaveAttribute("data-placement", "above");
      // Polled: the re-measure allows one pre-measure settle frame after the
      // content swap (the effect's documented contract), so the box is read
      // until it reflects the RE-placed position, not the transient one.
      const bottomAndTop = async () => {
        const box = await toolbar.boundingBox();
        if (!box) throw new Error("the toolbar has no box");
        return { top: box.y, bottom: box.y + box.height };
      };
      await expect.poll(async () => (await bottomAndTop()).bottom).toBeLessThanOrEqual(gesture.y);
      expect((await bottomAndTop()).top).toBeGreaterThanOrEqual(0);

      // Grow the bar again with the error line (empty submit) — still placed.
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("link-url-error")).toBeVisible();
      await expect.poll(async () => (await bottomAndTop()).bottom).toBeLessThanOrEqual(gesture.y);
      expect((await bottomAndTop()).top).toBeGreaterThanOrEqual(0);
    });

    test("Escape in the URL input backs out to the buttons without dismissing the bar", async ({
      page,
    }) => {
      await selectWord(page, fixture.paragraph);
      const toolbar = page.getByTestId("selection-toolbar");
      await toolbar.getByRole("button", { name: "Link" }).click();
      const input = page.getByTestId("link-url-input");
      await expect(input).toBeVisible();

      await input.press("Escape");

      await expect(input).toHaveCount(0);
      await expect(toolbar).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Bold" })).toBeVisible();
      // The selection the bar operates on is still pending — Escape here
      // closed the sub-editor, not the toolbar (the iframe-side Escape does
      // that, and it never fired: focus was in the host input).
      expect((await page.getByTestId("pending-selection").textContent())?.length).toBeGreaterThan(
        0,
      );
    });

    // ── Block actions (ticket #300) ─────────────────────────────────────────

    test("the H2 button converts the paragraph, distinguishes levels, and toggles back to a paragraph", async ({
      page,
    }) => {
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      const toolbar = page.getByTestId("selection-toolbar");
      const h2 = toolbar.getByRole("button", { name: "Heading 2" });
      const h3 = toolbar.getByRole("button", { name: "Heading 3" });
      await expect(h2).toHaveAttribute("aria-pressed", "false");
      const h2Before = await markCount(page, "h2", word);
      const pBefore = await markCount(page, "p", word);

      await h2.click();

      // The block really converted in the iframe's DOM, the ACTIVE LEVEL is
      // distinguished (H2 pressed, H3 not), and the toolbar survived the
      // conversion — the dispatch path re-reported geometry + formats.
      await expect(h2).toHaveAttribute("aria-pressed", "true");
      await expect(h3).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => markCount(page, "h2", word)).toBeGreaterThan(h2Before);
      await expect(toolbar).toBeVisible();

      // Clicking the ACTIVE level returns the block to a paragraph.
      await h2.click();
      await expect(h2).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => markCount(page, "h2", word)).toBe(h2Before);
      await expect.poll(() => markCount(page, "p", word)).toBe(pBefore);
    });

    test("the H1 and H3 buttons convert the block too — every exposed level really dispatches", async ({
      page,
    }) => {
      // #300 AC4: H2 is proven above; this pins the OTHER two levels as live
      // buttons (not just unpressed decorations) — H1 converts the paragraph,
      // and H3 then converts the H1 (level-to-level, no paragraph detour).
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      const toolbar = page.getByTestId("selection-toolbar");
      const h1 = toolbar.getByRole("button", { name: "Heading 1" });
      const h3 = toolbar.getByRole("button", { name: "Heading 3" });
      const h1Before = await markCount(page, "h1", word);
      const h3Before = await markCount(page, "h3", word);

      await h1.click();
      await expect(h1).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => markCount(page, "h1", word)).toBeGreaterThan(h1Before);

      await h3.click();
      await expect(h3).toHaveAttribute("aria-pressed", "true");
      await expect(h1).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => markCount(page, "h3", word)).toBeGreaterThan(h3Before);
      await expect.poll(() => markCount(page, "h1", word)).toBe(h1Before);
    });

    test("the ordered list button wraps the selection in an <ol> and lifts back out", async ({
      page,
    }) => {
      // #300 AC4: the ordered kind really dispatches (the bullet contract
      // below cannot prove it — the two buttons run different node types).
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      const toolbar = page.getByTestId("selection-toolbar");
      const ordered = toolbar.getByRole("button", { name: "Ordered list" });
      await expect(ordered).toHaveAttribute("aria-pressed", "false");
      const olBefore = await markCount(page, "ol", word);
      const pBefore = await markCount(page, "p", word);

      await ordered.click();

      await expect(ordered).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => markCount(page, "ol", word)).toBeGreaterThan(olBefore);
      await expect(toolbar).toBeVisible();

      // Clicking the ACTIVE kind lifts back out to a plain paragraph.
      await ordered.click();
      await expect(ordered).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => markCount(page, "ol", word)).toBe(olBefore);
      await expect.poll(() => markCount(page, "p", word)).toBe(pBefore);
    });

    test("the bullet list button wraps the selection, distinguishes kinds, and lifts back out", async ({
      page,
    }) => {
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      const toolbar = page.getByTestId("selection-toolbar");
      const bullet = toolbar.getByRole("button", { name: "Bullet list" });
      const ordered = toolbar.getByRole("button", { name: "Ordered list" });
      await expect(bullet).toHaveAttribute("aria-pressed", "false");
      const ulBefore = await markCount(page, "ul", word);
      const pBefore = await markCount(page, "p", word);

      await bullet.click();

      // Wrapped in the iframe's DOM, with the KIND distinguished (bullet
      // pressed, ordered not) and the toolbar still up.
      await expect(bullet).toHaveAttribute("aria-pressed", "true");
      await expect(ordered).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => markCount(page, "ul", word)).toBeGreaterThan(ulBefore);
      await expect(toolbar).toBeVisible();

      // Clicking the ACTIVE kind lifts the item back out; the text survives
      // as a plain paragraph.
      await bullet.click();
      await expect(bullet).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => markCount(page, "ul", word)).toBe(ulBefore);
      await expect.poll(() => markCount(page, "p", word)).toBe(pBefore);
    });

    // ── The Floating composer (ticket #298) ─────────────────────────────────

    /** Select the fixture word and swap the toolbar for the composer via the
     *  "…" bubble — the shared setup for the composer contracts. */
    async function openComposer(page: Page): Promise<string> {
      await selectWord(page, fixture.paragraph);
      const word = await selectedWord(page);
      await page
        .getByTestId("selection-toolbar")
        .getByRole("button", { name: "More actions" })
        .click();
      await expect(page.getByTestId("floating-composer")).toBeVisible();
      return word;
    }

    test('the "…" bubble swaps the toolbar for the composer, quote visible, inside the viewport', async ({
      page,
    }) => {
      const word = await openComposer(page);

      // A SWAP, not a stack: the toolbar is gone, the composer holds the
      // same anchor, and the quote shows the selected text.
      await expect(page.getByTestId("selection-toolbar")).toHaveCount(0);
      const composer = page.getByTestId("floating-composer");
      await expect(composer.getByTestId("floating-composer-quote")).toContainText(word);
      const box = await composer.boundingBox();
      if (!box) throw new Error("the composer has no box");
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      // The body took focus — typing goes straight into the composer.
      await expect(page.getByTestId("floating-composer-body")).toBeFocused();
    });

    test("typing + Ctrl+Enter posts: highlight in the document, comment in the panel", async ({
      page,
    }) => {
      await openComposer(page);
      const highlightsBefore = await page
        .locator("iframe")
        .contentFrame()
        .locator(".comment-highlight")
        .count();

      await page.keyboard.type("Needs a stronger example");
      await page.keyboard.press("Control+Enter");

      // Composer dismissed, the REAL highlight pipeline decorated the
      // anchored range inside the iframe, and the panel shows the Thread —
      // the same three effects a panel-composed comment had.
      await expect(page.getByTestId("floating-composer")).toHaveCount(0);
      await expect
        .poll(() => page.locator("iframe").contentFrame().locator(".comment-highlight").count())
        .toBeGreaterThan(highlightsBefore);
      await expect(page.getByTestId("panel-comment")).toHaveText("note: Needs a stronger example");
    });

    test("a failed post keeps the composer open with an inline error and the body preserved", async ({
      page,
    }) => {
      await openComposer(page);
      await page.evaluate(() => {
        (window as unknown as { __failComposerPost?: boolean }).__failComposerPost = true;
      });

      await page.keyboard.type("do not lose me");
      await page.keyboard.press("Control+Enter");

      // Inline role=alert error, composer still up, body intact — the
      // comment is never lost to a failed POST.
      await expect(page.getByTestId("floating-composer-error")).toBeVisible();
      await expect(page.getByTestId("floating-composer-body")).toHaveValue("do not lose me");

      // Disarm and retry: the same draft posts.
      await page.evaluate(() => {
        (window as unknown as { __failComposerPost?: boolean }).__failComposerPost = false;
      });
      await page.getByTestId("floating-composer-body").press("Control+Enter");
      await expect(page.getByTestId("floating-composer")).toHaveCount(0);
      await expect(page.getByTestId("panel-comment")).toHaveText("note: do not lose me");
    });

    test("Escape in the composer cancels it with the document selection intact", async ({
      page,
    }) => {
      await openComposer(page);

      await page.keyboard.press("Escape");

      // The composer is gone; the selection (and so its toolbar) survives —
      // composer Escape is layered ABOVE the editor's own Escape dismissal
      // (handleComposerKeyDown stops propagation), so the anchored chrome
      // falls back to the toolbar instead of vanishing entirely.
      await expect(page.getByTestId("floating-composer")).toHaveCount(0);
      await expect(page.getByTestId("selection-toolbar")).toBeVisible();
      expect((await page.getByTestId("pending-selection").textContent())?.length).toBeGreaterThan(
        0,
      );
    });

    test("a plain selection opens NO composer — the toolbar is all that appears", async ({
      page,
    }) => {
      // The retired contract, pinned from the browser: selecting text used
      // to auto-open the side panel's composer; now the toolbar alone shows
      // until the user asks for the composer.
      await selectWord(page, fixture.paragraph);
      await expect(page.getByTestId("selection-toolbar")).toBeVisible();
      await expect(page.getByTestId("floating-composer")).toHaveCount(0);
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

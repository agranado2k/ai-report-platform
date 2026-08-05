// BROWSER regression coverage for in-page anchor links in the editor
// (ADR-0062 Amendment 3, Decision 7).
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

let harnessPage: string;

test.beforeAll(async () => {
  harnessPage = await buildHarness();
});

/** The editing surface's own scroll offset and where the anchor target sits
 *  relative to its viewport — both read from the PARENT realm, since the
 *  iframe is `sandbox="allow-same-origin"` with no `allow-scripts`. */
async function readEditorScroll(page: import("@playwright/test").Page, targetId: string) {
  return await page.evaluate((id) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument as Document;
    return {
      scrollY: Math.round(iframe.contentWindow?.scrollY ?? -1),
      targetTop: Math.round(doc.getElementById(id)?.getBoundingClientRect().top ?? -1),
      viewportHeight: doc.documentElement.clientHeight,
    };
  }, targetId);
}

/** Click a link at its real on-screen position WITHOUT Playwright's
 *  auto-scroll: `locator.click()` scrolls the target into view first, which
 *  changes the very scroll state under test. */
async function clickLinkInEditor(page: import("@playwright/test").Page, href: string) {
  const point = await page.evaluate((h) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const frame = iframe.getBoundingClientRect();
    const link = iframe.contentDocument?.querySelector(`a[href="${h}"]`) as HTMLElement;
    const rect = link.getBoundingClientRect();
    return {
      x: frame.left + rect.left + rect.width / 2,
      y: frame.top + rect.top + rect.height / 2,
    };
  }, href);
  await page.mouse.click(point.x, point.y);
}

/**
 * Stand in for ProseMirror's post-click caret reveal.
 *
 * PM re-syncs its selection to the DOM after a click, and `DOMObserver`
 * defers that flush on a 20ms timeout — strictly AFTER the animation frame an
 * anchor scroll was deferred to. The browser then reveals the caret, which
 * scrolls the document back to wherever the caret is. That is the competitor
 * the anchor scroll used to lose to, and the ONLY thing this helper does is
 * make its timing deterministic instead of leaving it to PM's internals.
 */
async function armCaretReveal(page: import("@playwright/test").Page) {
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
    expect(before.targetTop).toBeGreaterThan(before.viewportHeight); // below the fold

    await clickLinkInEditor(page, "#deep-section");
    // Settle first — asserting on the first non-zero offset would just be a
    // race against however the scroll is implemented.
    await page.waitForTimeout(1500);

    const after = await readEditorScroll(page, "deep-section");
    // Brought into view, and top-aligned rather than merely revealed at the
    // bottom edge (ProseMirror's own `scrollIntoView` reveals minimally).
    expect(after.targetTop).toBeLessThan(before.viewportHeight / 2);
  });

  test("an id on a heading scrolls too, not just an id on a section", async ({ page }) => {
    const before = await readEditorScroll(page, "section-two");
    expect(before.targetTop).toBeGreaterThan(before.viewportHeight);

    await clickLinkInEditor(page, "#section-two");
    await page.waitForTimeout(1500);

    expect((await readEditorScroll(page, "section-two")).targetTop).toBeLessThan(
      before.viewportHeight / 2,
    );
  });

  // THE REGRESSION. This is the exact failure that shipped: the anchor scroll
  // was issued behind ProseMirror's back while the caret stayed on the TOC
  // link, so PM's reveal 20ms later dragged the document straight back — and
  // because the scroll was a `behavior: "smooth"` animation, it was abandoned
  // mid-flight and never resumed. Measured against the shipped code with this
  // very harness: the document ended at scrollY 10 with the target still
  // 1159px below the fold, i.e. visually "the click did nothing".
  test("the scroll survives ProseMirror's post-click caret reveal", async ({ page }) => {
    await armCaretReveal(page);
    const before = await readEditorScroll(page, "deep-section");

    await clickLinkInEditor(page, "#deep-section");
    await page.waitForTimeout(1500); // long enough for a smooth animation to finish or die

    const after = await readEditorScroll(page, "deep-section");
    expect(after.targetTop).toBeLessThan(before.viewportHeight / 2);
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

    expect(
      await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened),
    ).toEqual(["https://example.com/"]);
    expect((await readEditorScroll(page, "deep-section")).scrollY).toBe(0);
  });

  test("Alt+click suppresses activation so the link text stays editable", async ({ page }) => {
    const point = await page.evaluate(() => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      const frame = iframe.getBoundingClientRect();
      const link = iframe.contentDocument?.querySelector('a[href="#deep-section"]') as HTMLElement;
      const rect = link.getBoundingClientRect();
      return {
        x: frame.left + rect.left + rect.width / 2,
        y: frame.top + rect.top + rect.height / 2,
      };
    });
    await page.keyboard.down("Alt");
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up("Alt");
    await page.waitForTimeout(500);

    expect((await readEditorScroll(page, "deep-section")).scrollY).toBe(0);
  });
});

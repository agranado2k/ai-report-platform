// BROWSER coverage for the owner view's HASH behaviour (ADR-0089 §2; the tier
// is ADR-0079). Distinct from `owner-view-framing.spec.ts`, which needs a real
// HTTP origin to prove cookies and `frame-ancestors`: this one is about what
// the mounted React chrome does, so it runs over the `file://` harness like the
// rest of the tier.
//
// Why it can only live here: the contract is "adopted once at load, never
// re-read". That is a statement about mounting, an effect, and a later
// `hashchange` — a static SSR render can observe none of them, and apps/view
// has no jsdom tier. The pure half (`reportFrameSrc`) is unit-tested in
// `apps/view/app/view/frame.test.ts`; this is the composition the user meets.
import { expect, test } from "@playwright/test";
import { buildHarness } from "./harness/build.mjs";

const FRAME = "iframe[title]";

test.describe("the owner view's chrome", { tag: "@owner-view-chrome" }, () => {
  let harnessPage: string;

  test.beforeAll(async () => {
    // The fixture arg is unused by this entry (the chrome injects no report —
    // it frames one by URL); pass the existing one so the shared page-shell
    // writer has something to inline.
    harnessPage = await buildHarness("report.html", "entry-owner-view.tsx");
  });

  test("forwards the address bar's fragment into the frame at load", async ({ page }) => {
    await page.goto(`file://${harnessPage}#3`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    // `#3` in the chrome's own URL becomes `#3` on the framed report, which is
    // what makes `/<slug>/view#3` land on slide 3.
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345#3");
  });

  test("forwards a structured fragment verbatim — `#section/2` is not mangled", async ({
    page,
  }) => {
    await page.goto(`file://${harnessPage}#section/2`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    // The fragment used to be stripped of `/`, `?` and `\`, which silently
    // broke every report whose own anchors are path-shaped. Everything after
    // the `#` is the fragment by the URL grammar, so it can move where in the
    // document the frame lands and never which document.
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345#section/2");
  });

  test("frames the bare report when the chrome carries no fragment", async ({ page }) => {
    await page.goto(`file://${harnessPage}`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    // Not a trailing `#`: an empty fragment is not a destination.
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345");
  });

  test("a LATER top-level hash change does not remount or re-navigate the frame", async ({
    page,
  }) => {
    await page.goto(`file://${harnessPage}#3`);
    await expect(page.getByTestId("owner-view")).toBeVisible();
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345#3");

    // Brand the live element. If React tears the iframe down and builds a new
    // one — which a `key={hash}` remount does — the brand goes with it. This is
    // an identity check, not a value check: the `src` alone could be unchanged
    // across a remount that still threw away the report's state.
    await page.locator(FRAME).evaluate((el) => {
      (el as HTMLIFrameElement).dataset.brand = "original";
    });

    await page.evaluate(() => {
      window.location.hash = "#7";
    });
    // `hashchange` is dispatched asynchronously; give the listener that no
    // longer exists a real chance to fire before asserting it did nothing.
    await page.waitForFunction(() => window.location.hash === "#7");
    await page.waitForTimeout(150);

    // Same element, same src. The hash is adopted at LOAD and never re-read:
    // a live channel would reload the framed report on every hash change,
    // discarding deck position, scroll and any JS state the report had built
    // — to honour a navigation the report may have caused itself.
    await expect(page.locator(FRAME)).toHaveAttribute("data-brand", "original");
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345#3");
    await expect(page.locator(FRAME)).toHaveCount(1);
  });
});

// BROWSER coverage for the Comments panel's Open/Resolved filter (T8, report
// Z0W60dI8hu §06; the tier is ADR-0079). apps/view has no jsdom/component tier,
// so the filter's INTERACTIVE state — clicking Open ⇄ Resolved and watching
// threads appear and disappear — can only be exercised here; the filter's pure
// decision logic is unit-tested separately (apps/view/app/edit/comment-filter.ts).
// The harness mounts the REAL CommentsPanel over two fixture threads: an OPEN
// enhancement and a RESOLVED note. Runs under the `comments-panel` Playwright
// project, which greps the tag below (playwright.config.ts).
import { expect, test } from "@playwright/test";
import { buildHarness } from "./harness/build.mjs";

test.describe("the Comments panel filter", { tag: "@comments-panel" }, () => {
  let harnessPage: string;

  test.beforeAll(async () => {
    // The fixture arg is unused by the comments entry (no report iframe); pass
    // the existing one so the shared page-shell writer has something to inline.
    harnessPage = await buildHarness("report.html", "entry-comments.tsx");
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${harnessPage}`);
    await expect(page.getByTestId("comments-harness")).toBeVisible();
  });

  test("opens on the Open filter: the open thread shows, the resolved one is hidden", async ({
    page,
  }) => {
    await expect(page.getByText("can we split these")).toBeVisible();
    await expect(page.getByText("add the sample size")).toHaveCount(0);
    // The intent reads as a scannable pill, and the selection is quoted.
    await expect(page.getByText("Enhance")).toBeVisible();
    await expect(page.locator("blockquote").first()).toContainText("the quoted passage");
  });

  test("switching to Resolved swaps which threads are shown", async ({ page }) => {
    await page.getByRole("button", { name: /Resolved/ }).click();
    await expect(page.getByText("add the sample size")).toBeVisible();
    await expect(page.getByText("can we split these")).toHaveCount(0);

    // …and back to Open restores the open thread.
    await page.getByRole("button", { name: /Open/ }).click();
    await expect(page.getByText("can we split these")).toBeVisible();
    await expect(page.getByText("add the sample size")).toHaveCount(0);
  });

  test("the active filter is reflected on the pressed chip", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Open/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: /Resolved/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await page.getByRole("button", { name: /Resolved/ }).click();
    await expect(page.getByRole("button", { name: /Resolved/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: /Open/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

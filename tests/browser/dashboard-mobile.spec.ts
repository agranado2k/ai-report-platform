import { expect, test } from "@playwright/test";
import { buildDashboard } from "./harness/build-dashboard.mts";

let harness: string;
test.beforeAll(async () => {
  harness = await buildDashboard();
});

test.describe("Authenticated dashboard navigation and report list @dashboard-mobile", () => {
  test("opens and dismisses phone navigation with focus restoration", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`file://${harness}`);
    const menu = page.getByRole("button", { name: "Open navigation" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeHidden();
    await menu.click();
    await expect(page.getByRole("link", { name: "API keys & MCP", exact: true })).toBeVisible();
    expect(
      (await page.locator('a[href="/?folder=research"]').boundingBox())?.height,
    ).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(page.getByRole("link", { name: "API keys & MCP", exact: true })).toBeHidden();
  });

  for (const width of [320, 375, 390, 768, 1024, 1280]) {
    test(`keeps report content and touch actions within ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`file://${harness}`);
      const row = page.getByRole("listitem").filter({ hasText: "Quarterly research" });
      await expect(row).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(
        await page
          .locator("main")
          .first()
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const edit = page.getByRole("link", {
        name: "Edit Quarterly research and product strategy report",
      });
      await expect(edit).toBeVisible();
      await expect(
        page.getByRole("searchbox", { name: "Filter reports by title or slug" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Next →" })).toBeVisible();
      const action = page.getByText("Actions for Quarterly research and product strategy report");
      expect((await action.locator("..").boundingBox())?.height).toBeGreaterThanOrEqual(44);
      if (width === 375 || width === 1280) {
        await page.screenshot({
          path: `/tmp/centaur-dashboard-mobile-${width}.png`,
          fullPage: true,
        });
      }
    });
  }

  test("desktop collapse preference survives a phone navigation visit", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 812 });
    await page.goto(`file://${harness}`);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    const folder = page.locator('a[href="/?folder=research"]');
    await expect(folder).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 812 });
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  });

  test("search and pagination controls stay reachable in the report list", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`file://${harness}`);
    const search = page.getByRole("searchbox", { name: "Filter reports by title or slug" });
    await search.fill("quarterly");
    await expect(search).toHaveValue("quarterly");
    await expect(page.getByRole("link", { name: "Next →" })).toBeVisible();
  });

  test("keeps long breadcrumbs within the phone viewport while navigation is open", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto(`file://${harness}`);
    await page.getByRole("button", { name: "Open navigation" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";
import { buildDashboard } from "./harness/build-dashboard.mts";

let harness: string;
test.beforeAll(async () => {
  harness = await buildDashboard();
});

test.describe("Dashboard shell and report list (hermetic, no auth) @dashboard-mobile", () => {
  test("keeps folders above settings in short phone navigation", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 400 });
    await page.goto(`file://${harness}`);
    await page.getByRole("button", { name: "Open navigation" }).click();
    const folder = page.locator('a[href="/?folder=research"]');
    const settings = page.getByRole("link", { name: "API keys & MCP", exact: true });
    const folderBox = await folder.boundingBox();
    const settingsBox = await settings.boundingBox();
    if (!folderBox || !settingsBox) throw new Error("Navigation links must have layout boxes");
    expect(folderBox.y + folderBox.height).toBeLessThanOrEqual(settingsBox.y);
    await settings.click();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  });

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

  test("tabs from the phone header into the opened navigation", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`file://${harness}`);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Upload report", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Centaur — your reports" })).toBeFocused();
  });

  for (const width of [320, 375, 390, 768, 1024, 1280]) {
    test(`keeps report content and touch actions within ${width}px`, async ({ page }, testInfo) => {
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
      await expect(edit.locator("..")).toHaveCSS("opacity", "1");
      await expect(
        page.getByRole("searchbox", { name: "Filter reports by title or slug" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Next →" })).toBeVisible();
      expect(
        (await page.getByRole("link", { name: "Next →" }).boundingBox())?.height,
      ).toBeGreaterThanOrEqual(44);
      const action = page.getByText("Actions for Quarterly research and product strategy report");
      expect((await action.locator("..").boundingBox())?.height).toBeGreaterThanOrEqual(44);
      if (width === 375 || width === 1280) {
        await testInfo.attach(`dashboard-${width}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
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
    await expect(page.locator("#app-navigation")).toHaveAttribute("data-collapsed", "true");
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

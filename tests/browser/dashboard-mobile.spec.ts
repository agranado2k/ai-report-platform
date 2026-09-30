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
      const edit = page.getByRole("link", {
        name: "Edit Quarterly research and product strategy report",
      });
      await expect(edit).toBeVisible();
      const action = page.getByText("Actions for Quarterly research and product strategy report");
      expect((await action.locator("..").boundingBox())?.height).toBeGreaterThanOrEqual(44);
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
    const folder = page.getByRole("link", { name: "Research and product strategy", exact: true });
    await folder.click();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 812 });
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  });
});

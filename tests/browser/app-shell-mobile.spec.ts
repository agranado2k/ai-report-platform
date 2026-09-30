// BROWSER coverage for the app shell's phone navigation (#403; the tier is
// ADR-0079, extended to app components by its 2026-09-30 amendment). The
// PRODUCTION `AppShell` and `DashboardPage` are mounted with the app's compiled
// stylesheet (harness/build-app.mts) — so "closed on a phone", "the list uses
// the width" and "44px to tap" are measured on the classes the app ships.
//
// Why not the node tier: the shell's SSR smoke test sees one markup for every
// width. Which navigation is visible at 390px, where focus lands after Escape,
// and whether a resize keeps the desktop preference are statements about
// media queries, focus and effects — a real browser is the only place they exist.
import { expect, type Page, test } from "@playwright/test";
import { buildAppHarness } from "./harness/build-app.mjs";
import { horizontalOverflow, PHONE_WIDTHS, WIDE_WIDTHS } from "./harness/viewport";

const RAIL_KEY = "centaur.sidebar.collapsed";

let harness: string;
test.beforeAll(async () => {
  harness = await buildAppHarness("entry-app-dashboard.tsx");
});

const open = (page: Page, query = "") => page.goto(`file://${harness}${query}`);
const menuButton = (page: Page) => page.getByRole("button", { name: "Open navigation" });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Navigation" });

test.describe("phone navigation", { tag: "@app-components" }, () => {
  test.use({ hasTouch: true });

  for (const width of PHONE_WIDTHS) {
    test(`is closed by default at ${width}px and the Report list takes the width`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 740 });
      await open(page);

      await expect(menuButton(page)).toBeVisible();
      await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("link", { name: "API keys & MCP" })).toBeHidden();

      // The list starts at the left gutter, not beside a 256px rail.
      const list = await page.getByRole("list").first().boundingBox();
      expect(list?.x ?? 999).toBeLessThan(24);
      expect(list?.width ?? 0).toBeGreaterThan(width - 48);
      expect(await horizontalOverflow(page)).toBe(0);

      // A4: the trigger is a 44×44 target on a touch layout.
      const box = await menuButton(page).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  }

  test("opens explicitly, closes on Escape, and returns focus to its trigger", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await open(page);

    await menuButton(page).click();
    await expect(drawer(page)).toBeVisible();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    // Every destination the rail offers is reachable from the phone navigation.
    for (const name of ["Reports", "API keys & MCP", "Design reviews"]) {
      await expect(drawer(page).getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(drawer(page).getByRole("button", { name: "AG" })).toBeVisible();
    // Focus moved into the navigation, not left behind on the page.
    expect(await drawer(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("closes from its own Close button, which is a 44px target", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    await menuButton(page).click();

    const close = drawer(page).getByRole("button", { name: "Close navigation" });
    const box = await close.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(drawer(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
  });

  test("while open, the page behind it is inert", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await open(page);
    await menuButton(page).click();

    // Tabbing never reaches the Report list behind it. (Past the last control
    // a modal <dialog> may hand focus to the browser's own UI; it never hands
    // it to the page.)
    // CSS locators, not role ones: an inert subtree is out of the a11y tree.
    const behind = page.locator("main").first();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      expect(await behind.evaluate((m) => m.contains(document.activeElement))).toBe(false);
    }
    // And a pointer cannot reach it either: the header's Upload is covered.
    const link = page.locator('header a[href="/upload"]');
    const box = await link.boundingBox();
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("dialog") !== null,
      [(box?.x ?? 0) + 4, (box?.y ?? 0) + 4],
    );
    expect(hit).toBe(true);
  });

  test("choosing a destination navigates and closes the navigation", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await open(page);

    await menuButton(page).click();
    await drawer(page).getByRole("link", { name: "API keys & MCP" }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(page.getByRole("heading", { name: "API keys page" })).toBeVisible();

    await menuButton(page).click();
    await drawer(page).getByRole("link", { name: "Design reviews" }).click();
    await expect(drawer(page)).toBeHidden();
    expect(await page.evaluate(() => window.harnessLocation())).toBe("/?folder=fold_design");
    await expect(page.getByRole("heading", { name: "Your reports" })).toBeVisible();
  });

  test("choosing the page already shown still closes the navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await open(page);
    await menuButton(page).click();
    await drawer(page).getByRole("link", { name: "Reports", exact: true }).click();
    await expect(drawer(page)).toBeHidden();
  });

  test("a deep Folder trail keeps the current Folder and the Upload action on screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, "?path=/%3Ffolder%3Dfold_design");

    const upload = page.getByRole("link", { name: "Upload report" });
    await expect(upload).toBeVisible();
    const box = await upload.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(320);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByText("Design reviews"),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});

test.describe("wide layouts", { tag: "@app-components" }, () => {
  for (const width of WIDE_WIDTHS) {
    test(`keep the persistent sidebar at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      await expect(page.getByRole("link", { name: "API keys & MCP" })).toBeVisible();
      await expect(menuButton(page)).toBeHidden();
      await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }
});

test.describe("resizing between desktop and phone", { tag: "@app-components" }, () => {
  test("keeps the desktop collapse preference through a phone visit", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 740 });
    await menuButton(page).click();
    // The phone navigation is always the full one — the rail's collapse is a
    // desktop preference, not a phone one.
    await expect(drawer(page).getByRole("link", { name: "Design reviews" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), RAIL_KEY)).toBe("1");
  });

  test("an open phone navigation closes when the window grows to desktop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await open(page);
    await menuButton(page).click();
    await expect(drawer(page)).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(drawer(page)).toBeHidden();
    await expect(page.getByRole("link", { name: "API keys & MCP" })).toBeVisible();
    // The desktop preference was never touched by the phone navigation.
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), RAIL_KEY)).toBeNull();
  });
});

declare global {
  interface Window {
    harnessLocation: () => string;
  }
}

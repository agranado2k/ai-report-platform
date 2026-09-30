import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mintTestSession, type TestSession } from "../support/clerk-session";

const { Given, When, Then, After } = createBdd();

// The phone journey on the deployed preview (#403) — see the feature file for
// what it adds over the hermetic browser tier. Module state is safe under
// `workers: 1` (playwright.config.ts). Step phrasing is phone-specific so the
// global step registry has no clashes.

/** The PRD's reference phone width; the browser tier covers 320/375/390. */
const PHONE = { width: 390, height: 844 } as const;

let session: TestSession | undefined;
let slug: string | undefined;

const menuButton = (page: Page) => page.getByRole("button", { name: "Open navigation" });
const phoneNav = (page: Page) => page.getByRole("dialog", { name: "Navigation" });

/** CSS px of sideways scrolling on the document or any scrolling element. */
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => {
    const scrollers = [document.documentElement, ...document.querySelectorAll("body *")].filter(
      (el) => {
        if (el === document.documentElement) return true;
        const x = getComputedStyle(el).overflowX;
        return x === "auto" || x === "scroll";
      },
    );
    return Math.max(0, ...scrollers.map((el) => el.scrollWidth - el.clientWidth));
  });

Given("a Report of mine exists for the phone journey", async ({ page }) => {
  // The SAME primary fixture user the browser session belongs to
  // (clerk-auth.setup.ts); Bearer upload keeps this independent of the upload UI.
  session = await mintTestSession();
  const html = `<!doctype html><html><head><title>phone journey</title></head><body><h1>Phone journey ${randomUUID()}</h1></body></html>`;
  const uploaded = await page.request.post("/api/v1/reports", {
    headers: { Authorization: `Bearer ${session.jwt}` },
    multipart: {
      file: { name: "phone-journey.html", mimeType: "text/html", buffer: Buffer.from(html) },
    },
  });
  const body = (await uploaded.json()) as Record<string, unknown>;
  expect(uploaded.status(), JSON.stringify(body)).toBe(201);
  slug = body.slug as string;
});

Given("my browser is a 390px-wide phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
});

When("I open the dashboard on the phone", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status(), "a sign-in redirect here means the storageState is not authenticated").toBe(
    200,
  );
});

Then("the phone navigation is closed and the Report list takes the width", async ({ page }) => {
  await expect(menuButton(page)).toBeVisible();
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "API keys & MCP" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Your reports" })).toBeVisible();
  const box = await menuButton(page).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await horizontalOverflow(page)).toBe(0);
});

When("I open the phone navigation", async ({ page }) => {
  await menuButton(page).click();
  await expect(phoneNav(page)).toBeVisible();
});

Then("the phone navigation offers Reports, Folders, API keys and my account", async ({ page }) => {
  const nav = phoneNav(page);
  await expect(nav.getByRole("link", { name: "Reports", exact: true })).toBeVisible();
  await expect(nav.getByText("Folders", { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "API keys & MCP" })).toBeVisible();
  // Clerk's <UserButton>: its markup is Clerk's, so it is found by Clerk's
  // stable `cl-` element class or its default accessible name.
  await expect(
    nav
      .locator(".cl-userButtonTrigger")
      .or(nav.getByRole("button", { name: /user/i }))
      .first(),
  ).toBeVisible();
});

When("I dismiss the phone navigation with Escape", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(phoneNav(page)).toBeHidden();
});

Then("focus is back on the phone navigation's trigger", async ({ page }) => {
  await expect(menuButton(page)).toBeFocused();
});

When("I filter the phone Report list for that Report", async ({ page }) => {
  await page.getByRole("searchbox", { name: "Filter reports by title or slug" }).fill(slug ?? "");
  await expect(page).toHaveURL(new RegExp(`[?&]q=${slug}`));
});

Then(
  "that Report's row shows its status and its actions without sideways scrolling",
  async ({ page }) => {
    const row = page.getByRole("listitem").filter({ hasText: slug ?? "" });
    await expect(row).toHaveCount(1);
    const published = await row.getByText("Published", { exact: true }).isVisible();
    if (published) {
      // Open and Edit stay distinct, and Edit is visible without hover.
      await expect(row.locator(`a[href="/reports/${slug}/open"]`)).toHaveCount(1);
      const edit = row.locator(`a[href="/reports/${slug}/open?to=edit"]`);
      await expect(edit).toBeVisible();
      const box = await edit.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    } else {
      // Still scanning on the preview: a Processing Report gains no open/edit.
      await expect(row.getByText("Processing", { exact: true })).toBeVisible();
      await expect(row.locator('a[href*="/open"]')).toHaveCount(0);
    }
    await expect(row.locator("summary").filter({ hasText: "Actions for" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  },
);

When("I choose API keys from the phone navigation", async ({ page }) => {
  await menuButton(page).click();
  await phoneNav(page).getByRole("link", { name: "API keys & MCP" }).click();
});

Then("the phone navigation has closed on the API keys page", async ({ page }) => {
  await expect(page).toHaveURL(/\/settings\/api-keys$/);
  await expect(phoneNav(page)).toBeHidden();
  await expect(menuButton(page)).toBeVisible();
});

// Best-effort disposal of this scenario's Report. The hook registry is global,
// so this fires after every scenario; `slug` being set is what makes it ours.
After(async ({ request }) => {
  if (!slug || !session) return;
  try {
    await request.delete(`/api/v1/reports/${slug}`, {
      headers: { Authorization: `Bearer ${session.jwt}` },
    });
  } catch (error) {
    console.warn(`mobile-navigation cleanup: could not delete ${slug} — ${String(error)}`);
  }
  slug = undefined;
});

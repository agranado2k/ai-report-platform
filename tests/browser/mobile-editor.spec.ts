import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { buildMobileEditor } from "./harness/build-mobile-editor.mts";

let url: string;
test.beforeAll(async () => {
  url = pathToFileURL(await buildMobileEditor()).href;
});
test.describe("@synthetic-fixture mobile Editing session", () => {
  test("comments stack below a usable document and resizing preserves the mounted editor", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    let saved = "";
    await page.route("https://app.example.test/**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        saved = request.postData() ?? "";
        await route.fulfill({ json: { version: 3, scan_status: "pending" } });
      } else if (request.url().includes("/diff?")) {
        await route.fulfill({
          json: {
            from: { version_no: 1 },
            to: { version_no: 2 },
            html: "<p>Compared history</p>",
            diff_mode: "structural",
          },
        });
      } else {
        await route.fulfill({ json: { data: [], has_more: false } });
      }
    });
    await page.goto(url);
    const editor = page.locator("main iframe").first();
    await expect(editor).toBeVisible();
    await page
      .getByRole("button", { name: "Open comments and versions panel", exact: true })
      .click();
    const frame = editor.contentFrame();
    const paragraph = frame.locator("p").filter({ hasText: "commentable filler" });
    await paragraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" unsaved mobile change");
    const mounted = await editor.elementHandle();
    if (!mounted) {
      throw new Error("Editor did not mount");
    }
    for (const width of [375, 390, 768, 1024, 1280, 320]) {
      await page.setViewportSize({ width, height: 640 });
      await page.getByRole("button", { name: "Versions", exact: true }).click();
      await page.getByRole("button", { name: "Comments", exact: true }).click();
      await expect(frame.locator("body")).toContainText("unsaved mobile change");
      expect(await mounted.evaluate((el) => el.isConnected)).toBe(true);
      const documentBounds = await editor.boundingBox();
      const panelBounds = await page.locator("aside").boundingBox();
      expect(documentBounds?.width).toBeGreaterThanOrEqual(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      if (width >= 768) {
        expect(panelBounds?.width).toBe(320);
      }
    }
    const box = await editor.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(300);
    expect(box?.height).toBeGreaterThan(200);
    const pane = await page.locator("aside").boundingBox();
    if (!box || !pane) {
      throw new Error("Editor panes have no bounds");
    }
    expect(pane.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    await page.getByRole("button", { name: "Versions", exact: true }).click();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.getByText("Comparing v1 → v2")).toBeVisible();
    await page.getByRole("button", { name: "← Back to document", exact: true }).click();
    await expect(frame.locator("body")).toContainText("unsaved mobile change");
    expect(await mounted.evaluate((el) => el.isConnected)).toBe(true);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved as v3");
    expect(saved).toContain("unsaved mobile change");
  });
  test("selection formatting and comment actions fit a short phone screen", async ({
    page,
  }, testInfo) => {
    await page.route("https://app.example.test/**/comments", async (route) => {
      const input = route.request().postDataJSON();
      await route.fulfill({
        json: {
          object: "comment",
          id: "comment-1",
          report_id: "report-1",
          author_id: "editor",
          author: { id: "editor", name: "Editor", email: null },
          parent_id: null,
          edited_at: null,
          resolved_at: null,
          created_at: "2026-09-01T00:00:00Z",
          mode: "prod",
          ...input,
        },
      });
    });
    await page.setViewportSize({ width: 320, height: 260 });
    await page.goto(url);
    const paragraph = page
      .locator("main iframe")
      .first()
      .contentFrame()
      .locator("p")
      .filter({ hasText: "commentable filler" });
    await expect(paragraph).toBeVisible();
    await paragraph.dblclick({ position: { x: 60, y: 10 } });
    const toolbar = page.getByTestId("selection-toolbar");
    await expect(toolbar).toBeVisible();
    const boldBounds = await toolbar
      .getByRole("button", { name: "Bold", exact: true })
      .boundingBox();
    expect(boldBounds?.width).toBeGreaterThanOrEqual(44);
    expect(boldBounds?.height).toBeGreaterThanOrEqual(44);
    const box = await toolbar.boundingBox();
    if (!box) {
      throw new Error("Toolbar has no bounds");
    }
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(paragraph.locator("strong")).toBeVisible();
    await toolbar.getByRole("button", { name: "Link", exact: true }).click();
    await page.getByTestId("link-url-input").fill("https://example.test/reference");
    await page.getByTestId("link-url-input").press("Enter");
    await expect(paragraph.locator('a[href="https://example.test/reference"]')).toBeVisible();
    await toolbar.getByRole("button", { name: "More actions" }).click();
    const composer = page.getByRole("dialog", { name: "New comment" });
    await expect(composer).toBeVisible();
    await page.getByLabel("Comment body").fill("Phone comment");
    await expect(page.getByRole("button", { name: "Post comment" })).toBeInViewport({ ratio: 1 });
    const cbox = await composer.boundingBox();
    if (!cbox) {
      throw new Error("Composer has no bounds");
    }
    expect(cbox.x + cbox.width).toBeLessThanOrEqual(320);
    expect(cbox.x).toBeGreaterThanOrEqual(0);
    expect(cbox.y).toBeGreaterThanOrEqual(0);
    expect(cbox.y + cbox.height).toBeLessThanOrEqual(260);
    await testInfo.attach("short-screen-composer", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(composer).toHaveCount(0);
    await page.getByRole("button", { name: /Open comments and versions panel/ }).click();
    await expect(page.getByText("Phone comment", { exact: true })).toBeVisible();
  });
});

test("@real-report mobile panel preserves a representative Report", async ({ page }) => {
  const real = pathToFileURL(
    await buildMobileEditor("packages/report-html/src/fixtures/ai-readiness-report.html"),
  ).href;
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(real);
  const editor = page.locator("main iframe").first();
  await expect(editor).toBeVisible();
  const mounted = await editor.elementHandle();
  const paragraph = editor.contentFrame().locator("p").first();
  await paragraph.click();
  await page.keyboard.type("Persistent representative edit ");
  const before = await editor.contentFrame().locator("body").textContent();
  await page.getByRole("button", { name: /Open comments and versions panel/ }).click();
  expect((await editor.boundingBox())?.width).toBeGreaterThan(350);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "Hide panel" }).click();
  expect(await editor.contentFrame().locator("body").textContent()).toBe(before);
  expect(await mounted?.evaluate((el) => el.isConnected)).toBe(true);
  await expect(editor.contentFrame().locator("body")).toContainText(
    "Persistent representative edit",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
});

test("@synthetic-fixture mobile save failure preserves the draft for retry", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  let fail = true;
  let retried = "";
  await page.route("https://app.example.test/**", (route) => {
    if (!fail && route.request().method() === "POST") {
      retried = route.request().postData() ?? "";
    }
    return route.fulfill({
      status: fail ? 500 : 200,
      json: fail ? {} : { version: 3, scan_status: "pending", data: [], has_more: false },
    });
  });
  await page.goto(url);
  const frame = page.locator("main iframe").first().contentFrame();
  await frame.locator("p").filter({ hasText: "commentable filler" }).click();
  await page.keyboard.type("Retained draft ");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Save failed");
  await expect(frame.locator("body")).toContainText("Retained draft");
  fail = false;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved as v3");
  expect(retried).toContain("Retained draft");
});

test("@synthetic-fixture short screen version controls remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 260 });
  await page.goto(url);
  await page.getByRole("button", { name: /Open comments and versions panel/ }).click();
  await page.getByRole("button", { name: "Versions", exact: true }).click();
  const compare = page.getByRole("button", { name: "Compare", exact: true });
  await compare.scrollIntoViewIfNeeded();
  await expect(compare).toBeInViewport({ ratio: 1 });
});

test("@synthetic-fixture touch landscape keeps primary editor controls usable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(url);
    const save = page.getByRole("button", { name: "Save", exact: true });
    const toggle = page.getByRole("button", { name: /Open comments and versions panel/ });
    for (const control of [save, toggle]) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await toggle.tap();
    await page.getByRole("button", { name: "Versions", exact: true }).tap();
    for (const name of ["Comments", "Versions", "Compare", "Hide panel"]) {
      const control = page.getByRole("button", { name, exact: true });
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await expect(control).toBeInViewport({ ratio: 1 });
    }
  } finally {
    await context.close();
  }
});

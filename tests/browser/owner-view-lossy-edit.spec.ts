// BROWSER coverage for the lossy Edit confirm (ADR-0090; ticket #364). The
// tier is ADR-0079, and this spec runs over the `file://` harness like the rest
// of it — nothing here needs an origin, cookies or a header.
//
// Why it can only live here: every assertion below is about a native <dialog>.
// `showModal()`, the backdrop, Esc-to-close and the "did the click navigate?"
// question are platform behaviours, and apps/view has no jsdom tier
// (vitest is `environment: "node"`). The SSR half — that the dialog's markup
// exists, names the lost items and offers both ways out — is pinned in
// `apps/view/app/view/components/OwnerViewTopBar.test.ts`; this is the half a
// static render cannot observe.
import { expect, test } from "@playwright/test";
import { buildHarness } from "./harness/build.mjs";

test.describe("the owner view's Edit confirm on a lossy version", {
  tag: "@owner-view-lossy",
}, () => {
  let harnessPage: string;

  test.beforeAll(async () => {
    // The fixture arg is unused by this entry (the chrome frames a report by
    // URL rather than injecting one); pass the existing one so the shared
    // page-shell writer has something to inline.
    harnessPage = await buildHarness("report.html", "entry-owner-view.tsx", "production");
  });

  test("Edit opens the confirm instead of navigating, and names what a save would drop", async ({
    page,
  }) => {
    await page.goto(`file://${harnessPage}?lossy=1`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    const before = page.url();
    await page.getByRole("link", { name: "Edit", exact: true }).click();

    // The dialog is genuinely MODAL — `showModal()`, not `open`. A dialog
    // rendered open would look identical in markup and behave nothing like
    // this: no backdrop, no focus containment, no Esc.
    const dialog = page.locator("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d: HTMLDialogElement) => d.matches(":modal"))).toBe(true);

    // The navigation was intercepted, not followed. This is the whole point of
    // the confirm: the owner has not left the report yet.
    expect(page.url()).toBe(before);

    await expect(dialog).toContainText("script");
    await expect(dialog).toContainText("svg");
    await expect(dialog).toContainText("onclick");
    // The promise that makes cancelling safe to trust.
    await expect(dialog).toContainText(/until you save/i);
  });

  test("Cancel closes the confirm and changes nothing", async ({ page }) => {
    await page.goto(`file://${harnessPage}?lossy=1`);
    const before = page.url();

    await page.getByRole("link", { name: "Edit", exact: true }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();

    // Closed, still on the owner view, report still framed. "Cancelling
    // changes nothing" is ticket #364's own acceptance criterion, and the
    // reason it is cheap to assert is the reason it is true: the editor never
    // writes until Save, so this dialog never had anything to undo.
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(before);
    await expect(page.locator("iframe[title]")).toHaveAttribute("src", "/abcde12345");
  });

  test("Esc closes the confirm too — the platform's own way out", async ({ page }) => {
    await page.goto(`file://${harnessPage}?lossy=1`);
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Edit anyway is a real link to the editor — the confirm explains, it does not gate", async ({
    page,
  }) => {
    // ADR-0090 §5: nothing gates on fidelity, and a verdict that can go stale
    // must never be able to lock an owner out of their own report. So the
    // second action is an ordinary anchor to the same `/edit` the plain Edit
    // link points at.
    await page.goto(`file://${harnessPage}?lossy=1`);
    await page.getByRole("link", { name: "Edit", exact: true }).click();

    const proceed = page.getByRole("link", { name: "Edit anyway" });
    await expect(proceed).toBeVisible();
    await expect(proceed).toHaveAttribute("href", "/abcde12345/edit");
  });

  test("says something true when the probe could not name the items", async ({ page }) => {
    await page.goto(`file://${harnessPage}?lossy=unnamed`);
    await page.getByRole("link", { name: "Edit", exact: true }).click();

    const dialog = page.locator("dialog");
    await expect(dialog).toBeVisible();
    // No empty list, and no claim that nothing would be lost.
    await expect(dialog).toContainText(/inline scripts/i);
    await expect(dialog).toContainText(/until you save/i);
  });

  test("keeps the lossy Edit action touch-sized before opening its confirmation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`file://${harnessPage}?lossy=1`);
    const edit = page.getByRole("link", { name: "Edit", exact: true });
    const box = await edit.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await edit.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("keeps the lossy confirmation usable in a short phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 240 });
    await page.goto(`file://${harnessPage}?lossy=1`);
    await page.getByRole("link", { name: "Edit", exact: true }).click();

    const dialog = page.locator("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    // The harness mounts the real OwnerViewChrome with the production Tailwind
    // entry. The browser assertion proves the native dialog stays within the
    // phone viewport and that both actions remain reachable.
    expect(box?.width ?? 0).toBeLessThanOrEqual(320);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 240) + (box?.height ?? 240)).toBeLessThanOrEqual(240);
    const cancel = page.getByRole("button", { name: "Cancel" });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("link", { name: "Edit anyway" })).toBeInViewport({ ratio: 1 });
    for (const action of [cancel, page.getByRole("link", { name: "Edit anyway" })]) {
      const target = await action.boundingBox();
      expect(target?.height).toBeGreaterThanOrEqual(44);
      expect(target?.width).toBeGreaterThanOrEqual(44);
    }
    await cancel.click();
    await expect(dialog).toBeHidden();
  });

  test("a LOSSLESS version keeps Edit a plain navigation — no dialog at all", async ({ page }) => {
    // The common path. `lossless` and UNKNOWN both arrive here as a null
    // warning, so this one case covers both, and it must be exactly the
    // behaviour that shipped with ADR-0089.
    await page.goto(`file://${harnessPage}`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveAttribute(
      "href",
      "/abcde12345/edit",
    );
  });

  test.describe("phone touch input", () => {
    test.use({ hasTouch: true });

    test("keeps actions touch-sized after rotating to a wide phone viewport", async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.goto(`file://${harnessPage}?lossy=1`);
      for (const name of ["Open in new tab", "Versions", "Edit"]) {
        const action = page.getByRole("link", { name, exact: true });
        const box = await action.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole("link", { name: "Edit", exact: true }).tap();
      for (const action of [
        page.getByRole("button", { name: "Cancel", exact: true }),
        page.getByRole("link", { name: "Edit anyway", exact: true }),
      ]) {
        await expect(action).toBeInViewport({ ratio: 1 });
        const box = await action.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    });

    test("opens and cancels the warning with touch and restores keyboard focus", async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`file://${harnessPage}?lossy=1`);
      const edit = page.getByRole("link", { name: "Edit", exact: true });
      await edit.tap();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).tap();
      await expect(page.getByRole("dialog")).toBeHidden();
      await page.getByRole("link", { name: "Open in new tab" }).focus();
      // macOS WebKit uses Option-Tab to include links in keyboard traversal.
      // https://support.apple.com/guide/safari/cpsh003/mac
      const nextLink =
        browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
      await page.keyboard.press(nextLink);
      await expect(page.getByRole("link", { name: "Versions", exact: true })).toBeFocused();
      await page.keyboard.press(nextLink);
      await expect(edit).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(edit).toBeFocused();
    });
  });
});

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
    harnessPage = await buildHarness("report.html", "entry-owner-view.tsx");
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
});

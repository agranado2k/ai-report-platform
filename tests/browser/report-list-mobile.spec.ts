// BROWSER coverage for the Report list at phone and desktop widths (#403; the
// tier is ADR-0079, extended to app components by its 2026-09-30 amendment).
// The PRODUCTION DashboardPage and ReportRow are mounted inside the production
// AppShell with the app's compiled stylesheet — see harness/entry-app-dashboard.tsx
// for what the fixture stands in for (the loaders' data) and what it does not.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { buildAppHarness } from "./harness/build-app.mjs";
import { horizontalOverflow, PHONE_WIDTHS, WIDE_WIDTHS } from "./harness/viewport";

const LONG_TITLE =
  "An exceptionally long Report title that describes the Q3 enterprise onboarding research synthesis in full detail";
const LONG_FOLDER = "Quarterly customer research synthesis for the enterprise onboarding programme";

let harness: string;
test.beforeAll(async () => {
  harness = await buildAppHarness("entry-app-dashboard.tsx");
});

const open = (page: Page, query = "") => page.goto(`file://${harness}${query}`);
/** A Report's title line (the title also recurs in its menus and dialogs). */
const titleOf = (page: Page, title: string) => page.locator(`li p[title="${title}"]`);
const row = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ has: page.locator(`p[title="${title}"]`) });
const location = (page: Page) => page.evaluate(() => window.harnessLocation());

async function expectTouchTarget(target: Locator) {
  const box = await target.boundingBox();
  expect(box?.width ?? 0, "activation width").toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, "activation height").toBeGreaterThanOrEqual(44);
}

/** True when every probed point of `el` hit-tests to `el` itself — i.e. it is
 *  neither clipped by an ancestor nor covered by a later row. */
async function fullyOnTop(el: Locator): Promise<boolean> {
  await el.scrollIntoViewIfNeeded();
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    // 12px in from each corner: inside the menu's 16px rounded corners.
    const inset = 12;
    const points = [
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
      [r.left + r.width / 2, r.top + r.height / 2],
    ];
    return (
      r.left >= 0 &&
      r.right <= window.innerWidth &&
      points.every(([x, y]) => node.contains(document.elementFromPoint(x, y)))
    );
  });
}

test.describe("the Report list on a phone", { tag: "@app-components" }, () => {
  test.use({ hasTouch: true });

  for (const width of PHONE_WIDTHS) {
    test(`at ${width}px keeps every Report's facts and actions on screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      expect(await horizontalOverflow(page)).toBe(0);

      // A long title is read in full, not cut to one line.
      const title = titleOf(page, LONG_TITLE);
      await expect(title).toBeVisible();
      expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      // A long Folder name stays inside the row and names itself in full.
      const longRow = row(page, LONG_TITLE);
      const folder = longRow.getByTitle(LONG_FOLDER);
      await expect(folder).toBeVisible();
      const fbox = await folder.boundingBox();
      expect((fbox?.x ?? 0) + (fbox?.width ?? 999)).toBeLessThanOrEqual(width);

      // Publication, sharing, Editability and Fidelity stay legible.
      await expect(longRow.getByText("Published", { exact: true })).toBeVisible();
      await expect(
        row(page, "Pricing experiment (uploading)").getByText("Processing"),
      ).toBeVisible();
      await expect(row(page, "Legacy dashboard export").getByText("Can't edit")).toBeVisible();
      await expect(row(page, "Q3 roadmap review").getByText("Saving drops scripts")).toBeVisible();
      await expect(row(page, "Q3 roadmap review").getByText("Org", { exact: true })).toBeVisible();

      // Row actions are visible without hover, and each is a 44px target.
      const edit = longRow.getByRole("link", { name: `Edit ${LONG_TITLE}` });
      const sharing = longRow.getByLabel(`Sharing options for ${LONG_TITLE}`);
      for (const control of [edit, sharing]) {
        await expect(control).toBeVisible();
        await expectTouchTarget(control);
        const inside = await control.boundingBox();
        expect((inside?.x ?? 0) + (inside?.width ?? 999)).toBeLessThanOrEqual(width);
      }
      const kebab = longRow.locator("summary").filter({ hasText: `Actions for ${LONG_TITLE}` });
      await expectTouchTarget(kebab);
      expect(
        await kebab.evaluate((el) => {
          for (let n: Element | null = el; n; n = n.parentElement) {
            if (Number(getComputedStyle(n).opacity) < 1) return false;
          }
          return true;
        }),
      ).toBe(true);
    });
  }

  test("Open and Edit are distinct destinations, and a tap on Edit is Edit", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    const r = row(page, "Q3 roadmap review");
    await expect(r.getByRole("link", { name: "Open Q3 roadmap review" })).toHaveAttribute(
      "href",
      "/reports/slug000002/open",
    );
    const edit = r.getByRole("link", { name: "Edit Q3 roadmap review" });
    await expect(edit).toHaveAttribute("href", "/reports/slug000002/open?to=edit");
    // What a finger on Edit actually lands on is Edit, not the Open overlay.
    const hit = await edit.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return document
        .elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        ?.closest("a")
        ?.getAttribute("href");
    });
    expect(hit).toBe("/reports/slug000002/open?to=edit");
  });

  test("a Processing Report gains no open or edit action", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await open(page, "?list=processing");
    const r = row(page, "Freshly uploaded Report");
    await expect(r.getByText("Processing")).toBeVisible();
    await expect(r.locator('a[href*="/open"]')).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("an open row menu is neither clipped by the list nor covered by the next row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open(page);

    const first = row(page, LONG_TITLE);
    await first.locator("summary").filter({ hasText: "Actions for" }).click();
    expect(await fullyOnTop(first.locator("details[open] > div"))).toBe(true);

    const last = row(page, "Design critique notes");
    await last.locator("summary").filter({ hasText: "Actions for" }).click();
    expect(await fullyOnTop(last.locator("details[open] > div"))).toBe(true);
  });

  test("the sharing menu fits a 320px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await open(page);
    const r = row(page, "Q3 roadmap review");
    await r.getByLabel("Sharing options for Q3 roadmap review").click();
    expect(await fullyOnTop(r.locator("details[open] > div"))).toBe(true);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("search, Folder selection and pagination keep each other's state", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open(page, "?paged=1&path=/%3Ffolder%3Dfold_research");

    await page.getByRole("searchbox", { name: "Filter reports by title or slug" }).fill("legacy");
    await expect.poll(() => location(page)).toBe("/?folder=fold_research&q=legacy");
    await expect(titleOf(page, "Legacy dashboard export")).toBeVisible();

    const next = page.getByRole("link", { name: "Next →" });
    await expectTouchTarget(page.getByRole("link", { name: "← Prev" }));
    await next.click();
    await expect
      .poll(() => location(page))
      .toBe("/?q=legacy&folder=fold_research&starting_after=report_4");
  });

  test("no Reports, and no matches, each say what to do next", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await open(page, "?list=empty");
    await expect(page.getByText("No reports here yet")).toBeVisible();
    await expectTouchTarget(page.getByRole("link", { name: "Upload a report" }));
    expect(await horizontalOverflow(page)).toBe(0);

    await open(page);
    await page.getByRole("searchbox", { name: "Filter reports by title or slug" }).fill("zzzz");
    await expect(page.getByText("No matching reports")).toBeVisible();
    await expect(page.getByText("Try a different search term or clear the filter.")).toBeVisible();
    expect(await location(page)).toBe("/?q=zzzz");
  });

  test("a selected Folder's header fits a phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await open(page, "?path=/%3Ffolder%3Dfold_research");
    await expect(page.getByText("Manage")).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});

test.describe("the Report list on wider screens", { tag: "@app-components" }, () => {
  for (const width of WIDE_WIDTHS) {
    test(`at ${width}px keeps the scannable columns`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      expect(await horizontalOverflow(page)).toBe(0);

      // Name, status and sharing share one line per Report.
      const r = row(page, "Q3 roadmap review");
      const name = await titleOf(page, "Q3 roadmap review").boundingBox();
      const status = await r.getByText("Published", { exact: true }).boundingBox();
      expect(Math.abs((status?.y ?? 0) - (name?.y ?? 999))).toBeLessThan(24);
      expect(status?.x ?? 0).toBeGreaterThan((name?.x ?? 0) + 100);

      // A truncated long title still names itself in full.
      await expect(titleOf(page, LONG_TITLE)).toBeVisible();
    });
  }

  test("desktop keeps the hover reveal for row actions", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    const r = row(page, "Q3 roadmap review");
    const edit = r.getByRole("link", { name: "Edit Q3 roadmap review" });
    const opacity = () =>
      edit.evaluate((el) => Number(getComputedStyle(el.parentElement as Element).opacity));
    expect(await opacity()).toBe(0);
    await r.hover();
    await expect.poll(opacity).toBe(1);
  });
});

declare global {
  interface Window {
    harnessLocation: () => string;
  }
}

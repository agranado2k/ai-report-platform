import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mintTestSession, type TestSession } from "../support/clerk-session";

const { Given, When, Then } = createBdd();

// Module state — workers: 1 makes this safe (see playwright.config.ts). Distinct
// step phrasing from the other smoke files so the global registry has no clashes.
let session: TestSession;
let slug: string;

// The REAL ai-readiness-report.html fixture (also exercised by
// packages/report-html/src/shell.test.ts) rather than a synthetic snippet —
// it carries a genuine presentation shell (`:root { --bg: #0b0f17; … }`) and
// `.chip` elements, exactly the kind of styling the #171 regression stripped.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../packages/report-html/src/fixtures/ai-readiness-report.html",
);
const FIXTURE_HTML = readFileSync(FIXTURE_PATH, "utf-8");
const FIXTURE_BG = "#0b0f17";

Given("a report I own exists", async ({ request }) => {
  // Same primary fixture user (E2E_TEST_USER_EMAIL) as the browser session
  // established by tests/e2e/support/clerk-auth.setup.ts — minting a session
  // here (Bearer, machine path) rather than reusing the browser's cookies
  // means this upload doesn't depend on the browser project at all, and it
  // provisions the SAME actor's identity mirror the editor loader resolves.
  session = await mintTestSession();

  const response = await request.post("/api/v1/reports", {
    headers: { Authorization: `Bearer ${session.jwt}` },
    multipart: {
      file: {
        name: "ai-readiness-report.html",
        mimeType: "text/html",
        buffer: Buffer.from(FIXTURE_HTML, "utf8"),
      },
    },
  });
  const body = (await response.json()) as Record<string, unknown>;
  expect(response.status(), JSON.stringify(body)).toBe(201);
  expect(typeof body.slug).toBe("string");
  slug = body.slug as string;
});

When("I open the editor for that report", async ({ page }) => {
  await page.goto(`/reports/${slug}/edit`);
});

Then("I am not redirected to sign-in", async ({ page }) => {
  const url = page.url();
  expect(url).toContain(`/reports/${slug}/edit`);
  expect(url).not.toContain("/sign-in");
});

Then("the editor surface is present", async ({ page }) => {
  // SSR-rendered regardless of client mount state (ReportEditor always emits
  // the <iframe>; only `srcDoc` is deferred to a client effect) — reaching
  // this locator proves the authenticated route rendered its component tree
  // without 500ing, the exact #172 (DOMParser-in-SSR) regression class.
  await expect(page.locator('iframe[title="Report editor surface"]')).toBeVisible();
});

Then("the editor renders the report styled", async ({ page }) => {
  const editorFrame = page.frameLocator('iframe[title="Report editor surface"]');
  // ProseMirror's EditorView mounts directly into the iframe's own <body>
  // (`{ mount: body }` in ReportEditor.tsx) — its contenteditable attribute
  // only appears once the client-side mount effect has actually run, so its
  // presence proves the client mount succeeded (not just the SSR shell).
  await expect(editorFrame.locator("body")).toHaveAttribute("contenteditable", "true");
  // The report's OWN presentation shell must be live inside the iframe's
  // document — this is exactly what the #171 regression broke (the shell
  // never reached the client, so the editor rendered with none of the
  // report's CSS). Polled because `srcDoc` is set asynchronously after mount.
  await expect
    .poll(
      () =>
        editorFrame
          .locator(":root")
          .evaluate((el) => getComputedStyle(el).getPropertyValue("--bg").trim()),
      { message: "expected the report's --bg custom property to be live inside the iframe" },
    )
    .toBe(FIXTURE_BG);
});

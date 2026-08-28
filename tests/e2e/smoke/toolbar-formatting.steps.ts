// Steps for toolbar-formatting.feature — the formatting epic's single e2e
// round-trip (ticket #297): select in the deployed unified editor, bold via
// the Selection toolbar, Save, and assert the new ReportVersion carries the
// formatting all the way back onto the live document.
//
// Mirrors editor-auth.steps.ts's idioms (module state under workers: 1, the
// same fixture upload, the same scan-drain driving, `followToTerminal` for
// terminal-state assertions) with DISTINCT step phrasing — playwright-bdd's
// step registry is global, and reusing another file's step text would bind to
// that file's module state, not this one's.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mintTestSession, type TestSession } from "../support/clerk-session";
import { followToTerminal } from "../support/follow";

const { Given, When, Then } = createBdd();

// Same env seams as editor-auth.steps.ts (read once at module load): the
// deployed VIEW preview's own URL, and the per-PR scan-drain secret. Both are
// produced by preview-isolation.yml and threaded through e2e.yml; absent on a
// plain local `pnpm e2e`, where the guards below skip cleanly.
const VIEW_BASE_URL = process.env.PLAYWRIGHT_VIEW_BASE_URL;
const SCAN_DRAIN_SECRET = process.env.E2E_SCAN_DRAIN_SECRET;

// Module state — workers: 1 makes this safe (see playwright.config.ts).
let session: TestSession;
let slug: string;
/** The `oa=` owner fallback minted alongside the edit token — the credential
 *  the final read-only assertion presents as `?access=`. */
let ownerAccess: string;
/** The word the double-click actually selected, read from the editing
 *  iframe's own selection — what the `<strong>` assertions look for. */
let selectedWord: string;
let versionCountBefore: number;

// The REAL generated report (same fixture as editor-auth + the browser
// tier's @real-report project). Its `p.sub` paragraph is on screen at rest
// with a double-clickable word near its start — the same paragraph the
// browser tier selects (tests/browser/selection-toolbar.spec.ts).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../packages/report-html/src/fixtures/ai-readiness-report.html",
);
const FIXTURE_HTML = readFileSync(FIXTURE_PATH, "utf-8");
const PARAGRAPH = "p.sub";

/** Drive POST /internal/scan-drain until this report's NEWEST version reads
 *  `scan_status: clean` — previews have no scan cron (ADR-0045), so both the
 *  initial upload and the SAVED version need the drain driven from the test
 *  before they become live. Same shape as editor-auth.steps.ts's drain. */
async function drainUntilClean(api: APIRequestContext, targetSlug: string): Promise<void> {
  const auth = { Authorization: `Bearer ${session.jwt}` };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const drained = await api.post("/internal/scan-drain", {
      headers: { Authorization: `Bearer ${SCAN_DRAIN_SECRET}` },
    });
    expect(
      drained.status(),
      `POST /internal/scan-drain answered ${drained.status()} — 503 means SCAN_DRAIN_SECRET is unset on the preview, 401 means e2e.yml and preview-isolation.yml derived DIFFERENT values`,
    ).toBe(200);

    const versions = await api.get(`/api/v1/reports/${targetSlug}/versions`, { headers: auth });
    expect(versions.status()).toBe(200);
    const body = (await versions.json()) as { data?: { scan_status?: string }[] };
    if (body.data?.[0]?.scan_status === "clean") return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `report ${targetSlug} never reached scan_status: clean after 10 drain ticks — the scan pipeline, not the toolbar, is what failed here`,
  );
}

/** How many versions the report has, over the API (ADR-0053 list envelope).
 *  This scenario creates at most two, far under one page, so `data.length`
 *  is the honest count without walking cursors. */
async function versionCount(api: APIRequestContext): Promise<number> {
  const res = await api.get(`/api/v1/reports/${slug}/versions`, {
    headers: { Authorization: `Bearer ${session.jwt}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data?: unknown[] };
  return body.data?.length ?? 0;
}

Given("a bolded-word report I own has been uploaded and scanned clean", async ({ request }) => {
  test.skip(
    !SCAN_DRAIN_SECRET,
    "E2E_SCAN_DRAIN_SECRET not set — the scan drain cannot be driven, so the report never becomes servable",
  );
  session = await mintTestSession();

  const uploadResponse = await request.post("/api/v1/reports", {
    headers: { Authorization: `Bearer ${session.jwt}` },
    multipart: {
      file: {
        name: "ai-readiness-report.html",
        mimeType: "text/html",
        buffer: Buffer.from(FIXTURE_HTML, "utf8"),
      },
    },
  });
  const body = (await uploadResponse.json()) as Record<string, unknown>;
  expect(uploadResponse.status(), JSON.stringify(body)).toBe(201);
  expect(typeof body.slug).toBe("string");
  slug = body.slug as string;

  await drainUntilClean(request, slug);
});

Given("I have opened that report in the unified editor", async ({ page }) => {
  test.skip(
    !VIEW_BASE_URL,
    "PLAYWRIGHT_VIEW_BASE_URL not set — no deployed view origin to edit on",
  );

  // The app-side half of the hand-off (same seam editor-auth proves): /open
  // mints the edit token in the Location's query. With VIEW_ORIGIN now wired on
  // previews (issue #307) the Location's ORIGIN resolves to the real view alias
  // too, but we still lift `et=`/`oa=` out of it and navigate the browser
  // straight to the deployed view preview — determinism, independent of the
  // redirect origin.
  const open = await page.request.get(`/reports/${slug}/open`, { maxRedirects: 0 });
  const location = open.headers().location ?? "";
  const params = new URL(location).searchParams;
  const token = params.get("et");
  expect(token, `expected an et= token in Location "${location}"`).toBeTruthy();
  const oa = params.get("oa");
  expect(
    oa,
    `expected an oa= owner fallback in Location "${location}" — the opener IS the owner`,
  ).toBeTruthy();
  ownerAccess = oa as string;

  // A REAL navigation this time (editor-auth stops at request-level
  // assertions): the browser follows the 303, the arp_edit cookie lands in
  // the context, and the unified editor mounts for real.
  await page.goto(
    `${VIEW_BASE_URL}/${slug}/edit?et=${encodeURIComponent(token as string)}&oa=${encodeURIComponent(ownerAccess)}`,
  );
  await expect(page.getByTestId("unified-editor")).toBeVisible();

  // The editor mounts ProseMirror inside its sandboxed iframe in a client
  // effect — the paragraph under test becoming reachable is the signal
  // (same poll as the browser tier's beforeEach).
  await expect
    .poll(
      async () =>
        page.evaluate(
          (sel) =>
            (document.querySelector("iframe") as HTMLIFrameElement)?.contentDocument?.querySelector(
              sel,
            ) !== null,
          PARAGRAPH,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
});

When("I select a word of the report body", async ({ page }) => {
  // Double-click word selection at the paragraph's start, in HOST viewport
  // coordinates (element rect + the iframe's own offset) — the browser
  // tier's `selectWord`, inlined against the deployed page.
  const rect = await page.evaluate((sel) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) throw new Error("the editing surface has not mounted");
    const el = doc.querySelector(sel);
    if (!el) throw new Error(`the editing surface has no ${sel}`);
    const frame = iframe.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: frame.left + r.left, y: frame.top + r.top, height: r.height };
  }, PARAGRAPH);
  await page.mouse.dblclick(rect.x + 10, rect.y + Math.min(10, rect.height / 2));

  await expect(page.getByTestId("selection-toolbar")).toBeVisible();
  selectedWord = (
    await page.evaluate(
      () =>
        (document.querySelector("iframe") as HTMLIFrameElement)?.contentDocument
          ?.getSelection()
          ?.toString() ?? "",
    )
  ).trim();
  expect(selectedWord.length, "the double-click must have selected a word").toBeGreaterThan(0);
});

When("I bold the selection with the toolbar's Bold button", async ({ page }) => {
  const bold = page.getByTestId("selection-toolbar").getByRole("button", { name: "Bold" });
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await bold.click();
  // Live active state — the same contract the browser tier pins hermetically,
  // now observed on the deployed editor.
  await expect(bold).toHaveAttribute("aria-pressed", "true");
});

When("I save the formatted document", async ({ page }) => {
  versionCountBefore = await versionCount(page.request);
  await page.getByRole("button", { name: "Save" }).click();
  // The TopBar's live-region status reports the save (e.g. "Saved as v2 —
  // scan: pending"). The save is a cross-origin Bearer fetch (view → app,
  // ADR-0063 Phase 4) — give the round-trip room.
  await expect(page.getByRole("status")).toContainText(/Saved as v/, { timeout: 20_000 });
});

Then("a new report version exists for the formatted report", async ({ page }) => {
  expect(
    await versionCount(page.request),
    "saving must have created a new ReportVersion",
  ).toBeGreaterThan(versionCountBefore);
});

Then("the live document renders the bolded word in strong", async ({ page }) => {
  test.skip(!VIEW_BASE_URL, "PLAYWRIGHT_VIEW_BASE_URL not set — no view origin to read back from");
  test.skip(!SCAN_DRAIN_SECRET, "E2E_SCAN_DRAIN_SECRET not set — the saved version cannot go live");

  // The saved version starts scan-pending; drive the drain so it becomes the
  // LIVE version, then read the served document back through the owner's
  // read-only path (`?access=` carries the verified owner fallback — a bare
  // /{slug} would wall a private report's owner out, ADR-0080).
  await drainUntilClean(page.request, slug);
  const terminal = await followToTerminal(
    page.request,
    `${VIEW_BASE_URL}/${slug}?access=${encodeURIComponent(ownerAccess)}`,
  );
  const chain = terminal.hops.map((h) => `${h.status} ${h.url}`).join(" → ");
  expect(terminal.status, `expected the live document, got ${chain}`).toBe(200);

  // The word the toolbar bolded, now inside a <strong> in the SERVED bytes —
  // the round-trip's terminal fact: PM command → save → reassembly → scan →
  // live version. The fixture carries <strong> content of its own, so the
  // match is pinned to the exact selected word.
  const escaped = selectedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(terminal.body, `the live document must render "${selectedWord}" in <strong>`).toMatch(
    new RegExp(`<strong[^>]*>[^<]*${escaped}[^<]*</strong>`),
  );
});

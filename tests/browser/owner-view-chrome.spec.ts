// BROWSER coverage for the owner view's HASH behaviour (ADR-0089 §2; the tier
// is ADR-0079). Distinct from `owner-view-framing.spec.ts`, which needs a real
// HTTP origin to prove cookies and `frame-ancestors`: this one is about what
// the mounted React chrome does, so it runs over the `file://` harness like the
// rest of the tier.
//
// Why it can only live here: the contract is "adopted once at load, never
// re-read". That is a statement about mounting, an effect, and a later
// `hashchange` — a static SSR render can observe none of them, and apps/view
// has no jsdom tier. The pure half (`reportFrameSrc`) is unit-tested in
// `apps/view/app/view/frame.test.ts`; this is the composition the user meets.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { buildHarness } from "./harness/build.mjs";

const FRAME = "iframe[title]";
/** The slug the harness entry mounts the chrome with. */
const SLUG = "abcde12345";

test.describe("the owner view's chrome", { tag: "@owner-view-chrome" }, () => {
  let harnessPage: string;
  /** The other end of the funnel: the editor's side-panel chrome, seeded by
   *  the shipped `initialPanelState` from its own query string (#382). */
  let editorPage: string;
  let server: Server;
  let origin: string;

  test.beforeAll(async () => {
    // The fixture arg is unused by this entry (the chrome injects no report —
    // it frames one by URL); pass the existing one so the shared page-shell
    // writer has something to inline.
    harnessPage = await buildHarness("report.html", "entry-owner-view.tsx");
    editorPage = await buildHarness("report.html", "entry-edit-panel.tsx");

    // ONE ephemeral loopback server, for the funnel case below only (the hash
    // cases stay over `file://` — they are about React, not about an origin).
    // The owner view's actions are ROOT-ABSOLUTE links (`/<slug>/edit`), and
    // over `file://` those resolve to the filesystem root and never commit, so
    // a real click cannot be followed there at all. Two static pages behind
    // the two paths the chrome links to is the smallest thing that lets the
    // browser do what the owner's browser does. Still hermetic in every sense
    // ADR-0079 cares about — no deployment, no credentials, no database, no
    // network — and the precedent is `owner-view-framing.spec.ts`, which binds
    // one for the same reason (ADR-0089 §7).
    const pages: Record<string, string> = {
      [`/${SLUG}/view`]: harnessPage,
      [`/${SLUG}/edit`]: editorPage,
    };
    server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const file = pages[path];
      if (!file) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(file, "utf8"));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("forwards the address bar's fragment into the frame at load", async ({ page }) => {
    await page.goto(`file://${harnessPage}#3`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    // `#3` in the chrome's own URL becomes `#3` on the framed report, which is
    // what makes `/<slug>/view#3` land on slide 3.
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345#3");
  });

  test("forwards a structured fragment verbatim — `#section/2` is not mangled", async ({
    page,
  }) => {
    await page.goto(`file://${harnessPage}#section/2`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    // The fragment used to be stripped of `/`, `?` and `\`, which silently
    // broke every report whose own anchors are path-shaped. Everything after
    // the `#` is the fragment by the URL grammar, so it can move where in the
    // document the frame lands and never which document.
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345#section/2");
  });

  test("frames the bare report when the chrome carries no fragment", async ({ page }) => {
    await page.goto(`file://${harnessPage}`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    // Not a trailing `#`: an empty fragment is not a destination.
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345");
  });

  test("always offers an 'Open in new tab' escape to the top-level report (#385)", async ({
    page,
  }) => {
    // ADR-0092. The framed report runs in a storage-less opaque origin
    // (ADR-0089 §2); a deck that reads localStorage/cookie before paint blanks
    // there. This control opens the CANONICAL `/<slug>` as a TOP-LEVEL document,
    // where storage works and the hand-off's `Path=/<slug>` unlock cookie serves
    // it directly. No blank-detection — the opaque frame exposes no signal to
    // read — so the control is unconditional.
    await page.goto(`file://${harnessPage}`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    const open = page.getByRole("link", { name: "Open in new tab" });
    await expect(open).toHaveAttribute("href", "/abcde12345");
    // Top-level, not the frame; `noopener` denies the opened page a handle back.
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", "noopener");
  });

  test("keeps the 'Open in new tab' escape on the owner-read degrade (#385)", async ({ page }) => {
    // The escape matters MOST here: a read-capable owner whose edit round-trip
    // failed still needs to reach a report that blanks in the frame. Versions
    // and Edit are withheld on this degrade; the fallback is not.
    await page.goto(`file://${harnessPage}?canEdit=0`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    await expect(page.getByRole("link", { name: "Open in new tab" })).toHaveAttribute(
      "href",
      "/abcde12345",
    );
    await expect(page.getByRole("link", { name: "Versions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  });

  test("Versions deep-links into the editor's versions tab, in one click (#377)", async ({
    page,
  }) => {
    // Version history lives in the editor's own side panel, so Versions is a
    // deep link INTO the editor rather than a second destination. Pointing it
    // at a bare `/<slug>/edit` landed the owner with the panel CLOSED on the
    // comments tab — one click short of what they asked for, and nothing on
    // screen to say why. `?panel=versions` is the entry point that closes it
    // (`apps/view/app/edit/panel.ts`).
    //
    // Asserted here, on the MOUNTED chrome, because this is the composition:
    // the route builds the href and `OwnerViewTopBar` renders it, and the bar's
    // own fixture cannot prove the route agrees with it.
    await page.goto(`file://${harnessPage}`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    await expect(page.getByRole("link", { name: "Versions" })).toHaveAttribute(
      "href",
      "/abcde12345/edit?panel=versions",
    );
    // Edit stays the bare editor URL — the two props hold two intents, and
    // this is the assertion that keeps them from being quietly re-merged.
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveAttribute(
      "href",
      "/abcde12345/edit",
    );
  });

  test("Versions reaches the editor with the versions panel ALREADY OPEN (#382)", async ({
    page,
  }) => {
    // The claim #377 made and could not keep. Its href was right, but the
    // owner view's Versions action is a PLAIN LINK holding no capability
    // (ADR-0089 §4b), so the click funnels: the view gate, the app's one mint,
    // then back through the gate's clean-URL 303. Every one of those hops
    // rebuilds the URL from its parts, and every one of them dropped the hint
    // — so the editor opened closed on comments for the one click whose whole
    // purpose was version history.
    //
    // WHAT THIS TEST OWNS, and what it does not. The three redirect hops are
    // pinned in the node tier, at the seams that build them (gate.server.test
    // .ts, open-report.server.test.ts); the server behind this page is a
    // stand-in for them, not a re-implementation of them. What no node test
    // can observe is the end of the chain, and that is what runs here: a real
    // click, a real navigation carrying the query, and the editor's own panel
    // chrome MOUNTING open on versions from it. `initialPanelState` is a lazy
    // `useState` initialiser — a statement about mounting, which apps/view's
    // `environment: "node"` vitest tier cannot make.
    await page.goto(`${origin}/${SLUG}/view`);
    await expect(page.getByTestId("owner-view")).toBeVisible();

    await page.getByRole("link", { name: "Versions" }).click();
    await expect(page).toHaveURL(`${origin}/${SLUG}/edit?panel=versions`);

    await expect(page.getByTestId("side-panel")).toHaveAttribute("data-tab", "versions");
    await expect(page.getByRole("button", { name: "Versions" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Comments" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      page.getByRole("button", { name: /^Open comments and versions panel/ }),
    ).toHaveCount(0);
  });

  test("an ordinary editor visit is unchanged: closed, behind the edge affordance", async ({
    page,
  }) => {
    // The counterpart that makes the case above mean something. With no hint
    // the editor still opens document-dominant, so a panel that were open by
    // default could not satisfy both tests at once.
    await page.goto(`${origin}/${SLUG}/edit`);
    await expect(
      page.getByRole("button", { name: /^Open comments and versions panel/ }),
    ).toBeVisible();
    await expect(page.getByTestId("side-panel")).toHaveCount(0);
  });

  test("a LATER top-level hash change does not remount or re-navigate the frame", async ({
    page,
  }) => {
    await page.goto(`file://${harnessPage}#3`);
    await expect(page.getByTestId("owner-view")).toBeVisible();
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345#3");

    // Brand the live element. If React tears the iframe down and builds a new
    // one — which a `key={hash}` remount does — the brand goes with it. This is
    // an identity check, not a value check: the `src` alone could be unchanged
    // across a remount that still threw away the report's state.
    await page.locator(FRAME).evaluate((el) => {
      (el as HTMLIFrameElement).dataset.brand = "original";
    });

    await page.evaluate(() => {
      window.location.hash = "#7";
    });
    // `hashchange` is dispatched asynchronously; give the listener that no
    // longer exists a real chance to fire before asserting it did nothing.
    await page.waitForFunction(() => window.location.hash === "#7");
    await page.waitForTimeout(150);

    // Same element, same src. The hash is adopted at LOAD and never re-read:
    // a live channel would reload the framed report on every hash change,
    // discarding deck position, scroll and any JS state the report had built
    // — to honour a navigation the report may have caused itself.
    await expect(page.locator(FRAME)).toHaveAttribute("data-brand", "original");
    await expect(page.locator(FRAME)).toHaveAttribute("src", "/abcde12345#3");
    await expect(page.locator(FRAME)).toHaveCount(1);
  });
});

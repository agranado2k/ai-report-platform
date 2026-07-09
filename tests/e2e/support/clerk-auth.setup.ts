// Playwright SETUP project (not a BDD feature — a plain `@playwright/test`
// spec run once, before the `chromium-auth` project's tests). It establishes
// a real, interactive-equivalent Clerk BROWSER session and persists it as
// Playwright `storageState`, so every `@browser` scenario reuses one signed-in
// session instead of re-authenticating per test (playwright-bdd's `workers: 1`
// already serializes everything, but re-running the ticket dance per scenario
// would still burn a Clerk sign-in-token per test for no benefit).
//
// Gated the SAME way as the `@browser` scenarios themselves (see
// playwright.config.ts): if E2E_CLERK_SECRET_KEY / E2E_TEST_USER_EMAIL /
// E2E_CLERK_PUBLISHABLE_KEY are incomplete, this setup is never invoked
// because the `chromium-auth` project (its only dependent) never runs any
// `@browser`-tagged tests once grep'd out — but the plain BDD grep gate can't
// stop Playwright from still trying to run a *project's* own setup test, so
// this file self-checks and skips cleanly rather than throwing.
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";
import { mintPrimarySignInTicket } from "./clerk-session";
import { STORAGE_STATE_PATH } from "./storage-state-path";

setup("authenticate as the seeded Clerk test user", async ({ page }) => {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  const email = process.env.E2E_TEST_USER_EMAIL;
  const publishableKey = process.env.E2E_CLERK_PUBLISHABLE_KEY;
  setup.skip(
    !secretKey || !email || !publishableKey,
    "@browser needs E2E_CLERK_SECRET_KEY + E2E_TEST_USER_EMAIL + E2E_CLERK_PUBLISHABLE_KEY",
  );

  // Fetches a Clerk Testing Token from the Backend API — required so the
  // FAPI requests clerk-js makes from the browser bypass bot/captcha
  // protection. Both keys passed EXPLICITLY: the package's own env fallbacks
  // (CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY) don't match this repo's
  // E2E_-prefixed convention.
  await clerkSetup({ publishableKey, secretKey });

  // Must be registered on the page's context BEFORE any FAPI request is made
  // (it installs a `context.route` interceptor) — i.e. before `page.goto`,
  // which is what triggers clerk-js to start calling FAPI.
  await setupClerkTestingToken({ page });

  // Load a public page so @clerk/clerk-js initializes `window.Clerk` (root.tsx
  // wires PUBLIC_CLERK_PUBLISHABLE_KEY into ClerkApp for every route, so any
  // page works; "/sign-in" avoids depending on the dashboard's own loader).
  await page.goto("/sign-in");
  await clerk.loaded({ page });

  const ticket = await mintPrimarySignInTicket();
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket } });

  // Confirm the browser actually holds an authenticated Clerk session before
  // persisting storageState — a silent sign-in failure here would otherwise
  // surface later as a confusing redirect-to-/sign-in in the editor scenario.
  await expect
    .poll(() => page.evaluate(() => window.Clerk?.user?.id ?? null), {
      message: "expected window.Clerk.user to be set after ticket sign-in",
    })
    .not.toBeNull();

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});

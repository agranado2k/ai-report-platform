import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { STORAGE_STATE_PATH } from "./tests/e2e/support/storage-state-path";

// BDD execution harness (ADR-023, ADR-019). Walking-skeleton phase: only the
// smoke feature is generated + run. The 29 product .feature files under
// tests/e2e/features/ are intentionally NOT included yet — they have no step
// definitions, and playwright-bdd errors at collection on a generated spec with
// undefined steps. The `features` glob widens to 'tests/e2e/features/**' as step
// definitions land with the upload API (1d) and viewer (1e).
const testDir = defineBddConfig({
  features: ["tests/e2e/smoke/**/*.feature"],
  steps: ["tests/e2e/smoke/**/*.steps.ts", "tests/e2e/steps/**/*.ts"],
});

// @auth needs BOTH staging Clerk creds (the secret key to mint + the test
// user's email to look up). @browser (a real authenticated BROWSER session,
// tests/e2e/support/clerk-auth.setup.ts) needs those two PLUS the publishable
// key — the sign-in ticket exchange happens client-side via @clerk/clerk-js,
// which needs it to initialize `window.Clerk`.
const hasAuthCreds = Boolean(process.env.E2E_CLERK_SECRET_KEY && process.env.E2E_TEST_USER_EMAIL);
const hasBrowserCreds = hasAuthCreds && Boolean(process.env.E2E_CLERK_PUBLISHABLE_KEY);

export default defineConfig({
  testDir,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    // Set by CI from the Vercel preview deployment_status.target_url; defaults
    // to a locally-served app for `pnpm e2e` on a dev box.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    // Vercel preview deployments are protected by Deployment Protection — an
    // unauthenticated request gets 401. Send the automation bypass header when
    // the secret is present (Vercel → Protection Bypass for Automation; secret
    // in CI as VERCEL_AUTOMATION_BYPASS_SECRET). Absent locally → no header.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          // Persist the bypass as a cookie so follow-up/browser navigations
          // (the viewer page tests, later) stay authorized — per Vercel's
          // recommended Playwright config. Harmless for the request-only smoke.
          "x-vercel-set-bypass-cookie": "true",
        }
      : {},
    trace: "on-first-retry",
  },
  // Run only smoke now; never run @wip (later-phase) scenarios once the product
  // features are included. Grep out @auth and/or @browser when their creds are
  // incomplete (e.g. a local `pnpm e2e`, or a half-configured env) so they skip
  // rather than throw. This is the DEFAULT for any project that doesn't
  // override grep/grepInvert itself (only `chromium-auth` does, below).
  grep: /@smoke/,
  grepInvert: hasAuthCreds ? (hasBrowserCreds ? /@wip/ : /@wip|@browser/) : /@wip|@auth|@browser/,
  projects: [
    {
      // Establishes the authenticated browser session ONE time (storageState),
      // consumed by `chromium-auth` below. Not a BDD feature — a plain
      // @playwright/test spec, so it lives outside the BDD-generated `testDir`
      // and needs its own grep/grepInvert override: the top-level `grep:
      // /@smoke/` would otherwise exclude it outright (its title carries no
      // Gherkin tags at all). The spec self-skips (via `setup.skip`) when
      // creds are incomplete, so it's safe to always include this project.
      name: "setup",
      testDir: "tests/e2e/support",
      testMatch: /clerk-auth\.setup\.ts/,
      grep: /.*/,
      grepInvert: /(?!)/, // matches nothing — i.e. don't invert/exclude anything here
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // No storageState on this project — its `page`/`request` fixtures are
      // unauthenticated (or Bearer-authenticated via `request`, for @auth).
      // @browser scenarios need a REAL authenticated `page`, which only
      // `chromium-auth` provides, so always exclude @browser here regardless
      // of creds (unlike the top-level default, which only excludes it when
      // misconfigured) — otherwise a fully-configured env would make this
      // project ALSO attempt the editor scenario unauthenticated and fail.
      grepInvert: hasAuthCreds ? /@wip|@browser/ : /@wip|@auth|@browser/,
    },
    {
      // Runs ONLY @browser-tagged scenarios, with the `setup` project's
      // storageState applied — so an authenticated `page` fixture is
      // available without any scenario having to sign in itself. Own `grep`
      // override (replacing the top-level /@smoke/) since it targets @browser
      // specifically; `grepInvert` is left at its top-level default, which
      // already excludes @browser (hence this project's tests) whenever creds
      // are incomplete — so this project simply runs zero tests in that case,
      // and the `setup` project's own guard keeps that safe either way.
      name: "chromium-auth",
      dependencies: ["setup"],
      grep: /@browser/,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE_PATH },
    },
  ],
});

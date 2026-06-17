import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

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
  // features are included. @auth needs the staging Clerk creds (E2E_CLERK_SECRET_KEY)
  // to mint a session — grep it out when they're absent (e.g. a local `pnpm e2e`).
  grep: /@smoke/,
  grepInvert: process.env.E2E_CLERK_SECRET_KEY ? /@wip/ : /@wip|@auth/,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

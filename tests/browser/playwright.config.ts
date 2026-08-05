import { defineConfig, devices } from "@playwright/test";

// Component-level BROWSER tests for packages/editor — the tier itself is
// ADR-0079; the behavior it currently guards is ADR-0062 Amendment 3.
//
// Deliberately SEPARATE from the root playwright.config.ts. That one is the
// BDD/e2e harness (ADR-019/ADR-023): it runs Gherkin features against a live
// Vercel preview and needs Clerk credentials. This one is hermetic — a
// `file://` harness page, no deployment, no auth, no database — so it belongs
// in the fast unit gate, not the infrastructure-first one.

/** The editing pane's geometry is what the anchor assertions are stated in, so
 *  the viewport is pinned here rather than inherited. It must be applied at
 *  PROJECT level: a project's `use` replaces the top-level `use`, so spreading
 *  `devices["Desktop Chrome"]` down there would silently restore its 1280x720
 *  and every "700px viewport" number in the specs would describe a config the
 *  suite does not run. */
const VIEWPORT = { width: 1000, height: 700 } as const;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  // ONE worker, and the harness depends on it: every spec builds the same
  // `harness/index.generated.html` path, so parallel workers would race on
  // writing and reading that single file. Give this suite a second spec file
  // and either keep `workers: 1` or make the output path per-worker.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: VIEWPORT } }],
});

import { defineConfig, devices } from "@playwright/test";

// Component-level BROWSER tests for packages/editor (ADR-0062 Amendment 3).
//
// Deliberately SEPARATE from the root playwright.config.ts. That one is the
// BDD/e2e harness (ADR-019/ADR-023): it runs Gherkin features against a live
// Vercel preview and needs Clerk credentials. This one is hermetic — a
// `file://` harness page, no deployment, no auth, no database — so it belongs
// in the fast unit gate, not the infrastructure-first one.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1000, height: 700 },
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

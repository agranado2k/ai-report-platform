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
  // ONE worker, and the harness depends on it: the generated page path is
  // derived from the fixture's basename, so parallel workers running two
  // projects over the same fixture would race on writing and reading one file.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { trace: "on-first-retry" },
  // TWO PROJECTS, ONE SPEC FILE. Each fixture's `test.describe` carries a tag
  // and each project greps for one of them, which is what makes "the same
  // contracts, over a real report" a thing CI enforces rather than a thing
  // someone remembers to do.
  //
  // `real-report` is the ADR-0079 fidelity project. The rule it enforces — "a
  // fixture may be smaller than a real report, never different IN KIND" — was
  // violated by the commit that wrote it, and the node-tier guard that followed
  // (harness/fixture-fidelity.test.ts) can only see scroll-relevant CSS that is
  // absent from the synthetic fixture. It cannot see a differently-shaped DOM,
  // content two orders of magnitude longer, or an anchor 973px down a 20,828px
  // document. Running the real 86KB generated report through the same specs can.
  //
  // Both projects share the pinned viewport: the assertions are stated in terms
  // of the editing pane's geometry, and a project's `use` REPLACES the top-level
  // one, so it has to be repeated rather than inherited.
  projects: [
    {
      name: "chromium",
      grep: /@synthetic-fixture/,
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORT },
    },
    {
      name: "real-report",
      grep: /@real-report/,
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORT },
    },
  ],
});

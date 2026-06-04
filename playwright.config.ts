import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

// BDD execution harness (ADR-023, ADR-019). Walking-skeleton phase: only the
// smoke feature is generated + run. The 29 product .feature files under
// tests/e2e/features/ are intentionally NOT included yet — they have no step
// definitions, and playwright-bdd errors at collection on a generated spec with
// undefined steps. The `features` glob widens to 'tests/e2e/features/**' as step
// definitions land with the upload API (1d) and viewer (1e).
const testDir = defineBddConfig({
  features: ['tests/e2e/smoke/**/*.feature'],
  steps: ['tests/e2e/smoke/**/*.steps.ts', 'tests/e2e/steps/**/*.ts'],
});

export default defineConfig({
  testDir,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Set by CI from the Vercel preview deployment_status.target_url; defaults
    // to a locally-served app for `pnpm e2e` on a dev box.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Run only smoke now; never run @wip (later-phase) scenarios once the product
  // features are included.
  grep: /@smoke/,
  grepInvert: /@wip/,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

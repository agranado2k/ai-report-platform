// Split out from clerk-auth.setup.ts so playwright.config.ts can import the
// path WITHOUT pulling in @clerk/testing or executing a `test()`/`setup()`
// registration at config-load time (the config file is evaluated directly by
// Playwright's config loader, not run as a test file).
export const STORAGE_STATE_PATH = "tests/e2e/.auth/primary.json";

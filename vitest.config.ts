import { defineConfig } from "vitest/config";

// Root Vitest config. Unit tests live next to the code they cover, as
// `*.test.ts`, across the workspace packages (ADR-0042). Domain/application
// packages are pure (ADR-024), so no environment or setup files are needed.
// `apps/mcp` is included too: unlike the Remix apps (e2e-only), the MCP server's
// REST-client + tool-mapping logic is pure and unit-testable (ADR-003).
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/mcp/src/**/*.test.ts"],
    environment: "node",
    // The pglite tier (ADR-0046) migrates a fresh in-process Postgres per test
    // in beforeEach. Each migration snapshot makes that setup heavier, and the
    // integration + contract suites run many pglite instances in parallel —
    // under worker contention the default 10s hook timeout trips spuriously.
    hookTimeout: 30_000,
  },
});

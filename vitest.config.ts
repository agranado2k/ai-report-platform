import { defineConfig } from "vitest/config";

// Root Vitest config. Unit tests live next to the code they cover, as
// `*.test.ts`, across the workspace packages (ADR-0042). Domain/application
// packages are pure (ADR-024), so no environment or setup files are needed.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});

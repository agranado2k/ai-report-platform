import { defineConfig } from "vitest/config";

// Package-scoped Vitest config for `arp-domain`. The repo-wide suite still runs
// from the ROOT vitest.config.ts (ADR-0042) — this config exists so a single
// package's tests can be driven in isolation, which is what the Stryker vitest
// runner needs (ADR-0081): mutation testing only makes sense when the test
// command it re-runs per mutant covers just the mutated package.
//
// Keep the `include` glob in sync with the root config's
// `packages/*/src/**/*.test.ts` entry — same tier, same naming rule.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

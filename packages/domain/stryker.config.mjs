// Mutation testing for arp-domain (ADR-0081).
//
// An on-demand / differential gate, NOT a per-push check: run it when you want
// to know whether the domain's tests are load-bearing, or against the files a
// PR changed (`--mutate`). `packages/domain` is the calibration target because
// ADR-024 keeps it pure — no I/O, no environment — so every mutant is cheap.
//
// This is `.mjs` rather than `.json` on purpose. The JSON version carried its
// rationale in `_comment` / `_plugins_comment` keys, which Stryker's own
// validator reports as unknown options, and a `$schema` pointing at
// `../../node_modules/...` that does not resolve under pnpm's isolated layout
// (the package's copy is a symlink into `.pnpm/`, and the workspace root has no
// `@stryker-mutator` directory at all). A JS config takes real comments and
// needs no schema pointer, so the notes below cost nothing and the warnings go.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",

  // Explicit, not the default `@stryker-mutator/*` glob: under pnpm's isolated
  // node_modules the glob finds no sibling plugins next to the hoisted core,
  // and the runner fails with 'Cannot find TestRunner plugin "vitest"'.
  plugins: ["@stryker-mutator/vitest-runner"],

  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",

  mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts"],
  concurrency: 4,

  reporters: ["html", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation/domain.html" },

  // Diagnostic, not a gate: `break: null` means a low score never fails the
  // run. A surviving mutant is a question for a human, not a build failure.
  thresholds: { high: 90, low: 80, break: null },

  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};

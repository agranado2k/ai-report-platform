import { defineConfig } from "vitest/config";

// Root Vitest config. Unit tests live next to the code they cover, as
// `*.test.ts`, across the workspace packages (ADR-0042). Domain/application
// packages are pure (ADR-024), so no environment or setup files are needed.
// `apps/mcp` is included too: unlike the Remix apps (e2e-only), the MCP server's
// REST-client + tool-mapping logic is pure and unit-testable (ADR-003).
// `apps/app/app/server` also gets unit coverage for its transport-seam helpers
// (the `handle()` combinator, etc.) — these are pure enough to test with
// injected fakes, unlike the rest of the Remix app which stays e2e-only.
// The ProseMirror editor's STATE/TRANSFORM wiring (ADR-0062) —
// `prosemirror-state`/`-model`/`-commands` need no DOM at all, so
// `createEditorState`/keymap-bound commands, plus the SSR-safety test for
// `ReportEditor` itself, are cheap to unit-test — now live in
// `packages/editor/src/**/*.test.ts` (ADR-0071), covered by the
// `packages/*/src/**/*.test.ts` glob below. The MOUNTED `EditorView` (real
// DOM, real mouse input, real scrolling) is NOT covered here and is no longer
// e2e-only either: it has its own hermetic browser tier, `tests/browser/`
// (ADR-0079, `pnpm test:browser`), which runs in the same `unit` workflow.
// Deciding where a new editor test goes: pure decision logic → here; needs
// layout, scrolling, selection or native events → `tests/browser/`; needs a
// deployment, auth or the database → `tests/e2e/` (ADR-0019).
// `apps/view/app/server` is the SAME carve-out on the viewer app, added for
// the GET /<slug>/edit deep-link's pure URL-building helper (ADR-0063
// Decision 3) — apps/view otherwise has no unit-test tier at all (its Remix
// routes stay e2e-only), same as apps/app's routes.
// `apps/view/app/edit` is the in-viewer editor's CLIENT save-fetch helper
// (ADR-0063 Phase 4): a plain `fetch` wrapper with no DOM/React dependency
// (the browser's `fetch` and Node's are interface-compatible, and a fake
// `fetchImpl` is injected in tests either way), so it's cheap to unit-test
// directly rather than deferring it to e2e like the mounted editor route.
export default defineConfig({
  test: {
    // KEEP IN SYNC with the TDD pairing guard's source-tree regex
    // (GUARD_SOURCE_RE in scripts/guards.config.sh) — it hand-mirrors these
    // globs (plus the node:test tree scripts/docs-conformance/, which vitest
    // does not cover); adding a covered tree here without updating it silently
    // un-guards that tree.
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/mcp/src/**/*.test.ts",
      "apps/app/app/server/**/*.test.ts",
      // Pure, client-safe theming values (ADR-0086) — the Clerk `appearance`
      // config extracted out of root.tsx so its literals can be pinned by a
      // unit test (Clerk can't resolve `var()`, so the tokens are duplicated as
      // hex and the test catches drift). A plain data module with no DOM/React
      // dependency, so it lives in the fast node tier rather than e2e like the
      // rest of apps/app's routes.
      "apps/app/app/theme/**/*.test.ts",
      "apps/view/app/server/**/*.test.ts",
      "apps/view/app/edit/**/*.test.ts",
      // The browser tier's own node-tier guards (ADR-0079): properties of the
      // harness FILES — e.g. "the harness fixture carries every scroll-relevant
      // declaration the real report carries" — which need no browser and belong
      // in the fast gate. Playwright only collects `*.spec.ts` from that
      // directory, so the two never overlap.
      "tests/browser/**/*.test.ts",
      // The e2e SUPPORT layer's own guards. These are the helpers the Gherkin
      // steps lean on, and their edge cases (redirect loops, cookie carry-over
      // across origins, …) are pure enough to pin here rather than discovering
      // them on a preview. They take structural seams instead of importing
      // Playwright's runtime, so this stays a node-tier suite. Playwright's
      // `setup` project only collects `clerk-auth.setup.ts` from this directory
      // and playwright-bdd only collects `*.steps.ts`, so the tiers never
      // overlap.
      "tests/e2e/support/**/*.test.ts",
      // The prompt-eval tier's own KEYLESS guard (ADR-0083). The evals
      // themselves need a provider API key and cost money, so they run only in
      // `.github/workflows/prompt-evals.yml`; what belongs in the fast gate is
      // the structural claim — the promptfoo config parses, every `file://` it
      // names exists, every golden-set case carries a reference solution, and
      // the generated tool fixture still matches the live `apps/mcp`
      // registrations. Nothing here calls a model. This is a test-only tree, so
      // there is nothing to mirror into the guard's source-tree regex.
      "tests/evals/**/*.test.ts",
      // The repo's own SHELL tooling under scripts/ — today the TDD pairing
      // guard (scripts/tdd-pairing-guard.sh), driven end-to-end against
      // throwaway git repositories: real commits, real `git diff`, since what
      // is asserted IS the diff classification. Only `*.test.ts` DRIVERS live
      // in this glob, and the guard already classifies `*.test.ts` as a test
      // file, so this adds nothing to mirror into its source regex (the one
      // scripts/ tree that IS covered source — scripts/docs-conformance/ —
      // was already listed there before this glob existed).
      "scripts/**/*.test.ts",
    ],
    environment: "node",
    // The pglite tier (ADR-0046) migrates a fresh in-process Postgres per test
    // in beforeEach. Each migration snapshot makes that setup heavier, and the
    // integration + contract suites run many pglite instances in parallel —
    // under worker contention the default 10s hook timeout trips spuriously.
    hookTimeout: 30_000,
  },
});

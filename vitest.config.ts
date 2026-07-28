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
// `packages/*/src/**/*.test.ts` glob below; the mounted `EditorView` (real
// DOM, real keyboard events) stays e2e-only like the rest of the Remix UI.
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
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/mcp/src/**/*.test.ts",
      "apps/app/app/server/**/*.test.ts",
      "apps/view/app/server/**/*.test.ts",
      "apps/view/app/edit/**/*.test.ts",
    ],
    environment: "node",
    // The pglite tier (ADR-0046) migrates a fresh in-process Postgres per test
    // in beforeEach. Each migration snapshot makes that setup heavier, and the
    // integration + contract suites run many pglite instances in parallel —
    // under worker contention the default 10s hook timeout trips spuriously.
    hookTimeout: 30_000,
  },
});

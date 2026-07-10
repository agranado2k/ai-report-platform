# ADR-0071: Extract shared `packages/ui` + `packages/editor`

- **Status**: Accepted
- **Date**: 2026-07-10
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0062 (editing model & Report HTML schema — owns `iframe-document.ts`'s CSP), ADR-0063 (in-viewer editing on the viewer origin — the reason a second consumer exists at all), ADR-0064 (comments & annotations).

## Context and problem statement

`apps/app/app/components/` and `apps/app/app/editor/` held two things that were never actually app-specific: the Tailwind UI primitives (`Button`, `Card`, `Badge`, `Input`, `icons`, `cx`) and the ProseMirror editor plumbing (`anchor.ts`, `comment-decorations.ts`, `editor-state.ts`, `iframe-document.ts`, `ReportEditor.tsx`). ADR-0063 commits to in-viewer editing landing on `apps/view` (implementation still gated on security review) — once it ships, `apps/view` needs the same `ReportEditor` and the same UI primitives, or it gets a second, drifting copy of both. The editor plumbing is the more urgent case: `iframe-document.ts` builds and CSP-locks the sandboxed iframe the untrusted report HTML renders into (ADR-0062 §9 amendment) — a second hand-copied version in `apps/view` would be a second place to get that CSP subtly wrong.

## Decision drivers

- Single source of truth for `iframe-document.ts`'s CSP — a security-relevant module must not fork across two apps.
- `apps/view` (ADR-0063) will need `ReportEditor` and the UI primitives; extracting now, while there's exactly one consumer, is a pure mechanical move — no behavior change, no new abstraction to design. Waiting until `apps/view` needs it means doing the same move under time pressure plus reconciling whatever `apps/view` grew independently in the meantime.
- Match the existing workspace-package shape exactly (`packages/headers`, `packages/report-html`): `src/`-as-`main`/`types`, `exports` map, `tsc --noEmit` for typecheck, no build step — so the new packages are unsurprising to navigate.

## Decision outcome

Two new workspace packages, both `private`, no build step (consumed as source via `main`/`types` pointing at `src/index.ts`, same as every other package in this repo):

- **`packages/ui`** (`arp-ui`) — `cx`, `Button`/`buttonClass`, `Card`, `Badge`, `Input`/`Select`/`Textarea`, the inline SVG `icons`. `react` is a `peerDependency`; Tailwind utility classes only, no CSS import — the consumer supplies the Tailwind build.
- **`packages/editor`** (`arp-editor`) — `anchor.ts` (`buildSelectionAnchor`), `comment-decorations.ts` (`resolvableCommentRanges`, `commentHighlightsKey`), `editor-state.ts` (`createEditorState`, `docJson`, `editorPlugins`), `iframe-document.ts` (`buildIframeDocument`), and `ReportEditor.tsx` (the mounted component). Depends on `arp-report-html` (`workspace:*`) for `reportSchema`/`PMDocJson`/`Shell`, the six `prosemirror-*` packages (pinned to the exact versions `apps/app` already carried), `react` as a peer, and `linkedom` as a devDependency (`iframe-document.test.ts`'s injected comment-aware parser — production uses the browser's native `DOMParser`, same split `arp-report-html` already established for its own DOM backend).

`apps/app/app/components/index.ts` re-exports the UI primitives from `arp-ui` alongside the app-specific components it kept (`AppHeader`, `CopyButton`, `EmptyState`, `FolderTree`, `Logo`, `PageShell`, `RenameReportForm`, `StatusBadge`) — every existing `./components/index` import site in `apps/app` kept working unchanged. `CommentSidebar.tsx` stayed in `apps/app` (it's coupled to Remix's `useFetcher` and the edit route) and now imports `buildSelectionAnchor`/`EditorSelection` from `arp-editor` instead of the deleted `../editor/anchor` and `./ReportEditor`.

## Considered options

- **Leave both in `apps/app` and hand-copy into `apps/view` when ADR-0063 ships** — rejected for the CSP reason above (two copies of a security-relevant module), and because the copy would happen under the time pressure of shipping ADR-0063 rather than as an isolated, easily-reviewed mechanical move.
- **One combined `packages/app-shared` package for both UI and editor** — rejected: UI primitives and editor plumbing have unrelated dependency graphs (`react` alone vs. six `prosemirror-*` packages plus `arp-report-html`) and unrelated reasons to change; splitting them keeps each package's `package.json` an honest declaration of what it actually needs.

## Consequences

- **Good**: `iframe-document.ts` now has exactly one copy for `apps/view` to import when ADR-0063's implementation lands, instead of a second copy to keep in sync by hand.
- **Good**: mechanical move only — no behavior change; all 30 moved/existing editor tests pass unchanged in their new home (only import-path and one test-fixture relative-path fix), and the full workspace suite (141 files / 1093 tests) stays green.
- **Trade-off**: one more package boundary to cross when editing UI primitives or editor plumbing from `apps/app` (import from `arp-ui`/`arp-editor` instead of a sibling file) — accepted as the standard cost of the workspace-package pattern this repo already uses for `arp-headers`/`arp-report-html`.

## More information

- `packages/ui/src/index.ts`, `packages/editor/src/index.ts` — the barrel exports.
- `packages/editor/src/iframe-document.ts` — the CSP this ADR consolidates to one copy.
- `apps/app/app/components/index.ts` — the re-export shim that kept existing import sites unchanged.

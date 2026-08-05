# ADR-0079: A hermetic browser test tier for `packages/editor`

- **Status**: Accepted
- **Date**: 2026-08-05
- **Deciders**: agranado2k
- **Supersedes / amends**: extends the two-tier reasoning of ADR-0046 (in-process pglite below the Neon e2e tier) to the editing surface; clarifies ADR-0019 (infrastructure-first delivery) the same way ADR-0046 does; builds on ADR-0042 (Vitest as the unit tier) and ADR-0071 (`packages/editor` as its own package). The behaviour it currently guards is ADR-0062 Amendment 3, Decision 7.
- **Superseded by**: —

## Context and problem statement

On 2026-08-05 the in-page anchor scroll shipped in PR #243 under a **fully green unit suite** and was inert in production: clicking a table-of-contents link in `/edit` left the document exactly where it was. Every unit test passed identically before and after the fix, because the defect was not in any pure function — it was an **ordering fact** about a mounted `EditorView` and a real browser's scrolling box. The node tier structurally cannot observe that class of bug, and the e2e tier did not cover it either.

The same package had already been bitten once by the same shape of gap: ProseMirror's `handleClick` prop never fired inside the editor's sandboxed iframe (Chrome kills PM's internal mouse-down tracker there), while the pure lookup it called was unit-tested and green.

The planned `/ce-dogfood` browser pass was the only step in the process that would have caught the anchor bug, and it was skipped. **Relying on remembering to run a manual pass is not a control.**

So: where do "a real browser, a mounted editor" tests belong? `packages/editor` sits between the two tiers this repo already has — it is neither pure (ADR-0042's Vitest job cannot mount an `EditorView`) nor infrastructure-dependent (ADR-0019's e2e job needs a Vercel preview, Clerk credentials and Neon, none of which the editing surface's click handling has anything to do with).

## Decision drivers

- Catch mounted-editor / real-browser ordering bugs in the **fast** gate, not only in a manual pass or at e2e time.
- Do not weaken ADR-0019: the e2e tier stays infrastructure-first and unmocked.
- Do not put a browser-dependent test in the Vitest job, whose whole premise (ADR-0042) is that the code under test is pure and environment-free.
- Keep the new tier **hermetic** — a test that needs a deployment is an e2e test, whatever directory it lives in.
- No second copy of the app: the harness must resolve the same packages `apps/view` resolves, or it will drift.

## Considered options

1. **A hermetic Playwright tier with its own config, run in the `unit` workflow** *(chosen)* — a `file://` harness page bundling the real `ReportEditor`, driven with real mouse input, no deployment/auth/database.
2. **Add the cases to the existing BDD/e2e suite** (ADR-0019/0023) — rejected: it would make a pure client-side interaction depend on a Vercel preview, Clerk credentials and Neon, and it would run in the slow gate. The bug has nothing to do with any of them, and coupling it to them makes it flakier and later.
3. **jsdom / happy-dom inside Vitest** — rejected: the defect is a *scrolling* and *selection-reveal* ordering fact. jsdom has no layout, no scrolling box, and no browser caret behaviour, so the very thing under test does not exist there. It would produce a green test that proves nothing — the exact failure mode being fixed.
4. **Rely on `/ce-dogfood`** — rejected: this is what was already relied on, and it was skipped. A manual step is not a gate.
5. **Playwright component testing (`@playwright/experimental-ct-react`)** — rejected: an experimental dependency and a second bundling pipeline, for something a 60-line esbuild harness already does with the app's own resolution.

## Decision outcome

Chosen: **option 1**. `tests/browser/` is a third test tier with an explicit boundary.

1. **What it is for.** Behaviour of the **mounted** editing surface that only exists in a real browser: scroll ordering, caret/selection reveal, native event delivery inside the sandboxed iframe, click-vs-drag with real mouse input, and the interaction between ProseMirror's own DOM effects and ours.

2. **Its boundary versus the other two tiers.**
   - **Node tier (ADR-0042, Vitest)** — anything pure: the state/transform layer, the click-decision rules, the schema. If it can be decided without layout, it belongs there, and putting it here instead makes the fast gate slower for no gain.
   - **This tier** — needs a real browser, needs nothing else. No network, no server.
   - **e2e tier (ADR-0019/0023, Playwright + BDD)** — anything that needs the deployed system: auth, the save round-trip, the API, the database. If a test needs a preview URL, it is an e2e test.

3. **It runs in `unit.yml`, not `e2e.yml`.** The gate a test belongs in follows what it *depends on*, not what tool it uses. This tier depends on Chromium and nothing else, so it belongs beside the other fast checks; `e2e.yml` exists to run against real provisioned infrastructure (ADR-0019), and adding a hermetic suite to it would make a fast check wait on a deployment. It is a separate job rather than a step inside the Vitest job because it needs a Playwright browser install that the pure job should not pay for.

4. **It is hermetic, and that is a rule, not an accident.** The harness (`tests/browser/harness/build.mts`) bundles `entry.tsx` with esbuild, `resolveDir` pointed at `apps/view` so it resolves `arp-editor` / `arp-report-html` / React exactly as the app does, writes a self-contained HTML file, and the spec loads it over `file://`. No deployment, no auth, no database, no fixtures in R2. **A test in this directory that needs a server is in the wrong directory.**

5. **Its own Playwright config**, `tests/browser/playwright.config.ts`, separate from the root one. The root config is the BDD/e2e harness and carries preview-URL and Clerk wiring this tier must not inherit. The viewport is pinned at project level (a project's `use` replaces the top-level `use`), and `workers: 1` is a correctness requirement rather than a performance choice: every spec builds the same `harness/index.generated.html` path.

6. **Chromium only.** The same limitation ADR-0062 Amendment 3 already records for its browser verification. Safari and Firefox diverge on CSP-sandbox behaviour for top-level documents and on selection/scroll-anchoring details, so a WebKit project here would be worth adding — but a Chrome-only tier that catches Chrome-only regressions is strictly better than no tier, and Chrome is where the production bug was reported.

## Consequences

- **Good**: the anchor regression is now covered by an automated check that fails on the shipped-broken code, instead of by a manual pass someone has to remember. The tier generalises — the sandboxed-iframe `handleClick` failure and the comment click-to-highlight path are the same shape of bug and now have the same kind of coverage.
- **Honest limitation, recorded because it is the tier's weak point**: the scroll tests' discriminating power currently depends on a **modelled competitor**. `armCaretReveal` is a hand-written stand-in for the post-click scroll that reveals the caret — the real mechanism in ProseMirror is **not determined** (see ADR-0062 Decision 7 for the two candidates that were checked against prosemirror-view's source and refuted). The harness does **not** reproduce the production bug on its own; only the one regression test does, and only because it injects that synthetic competitor. So the guard protects against a regression of the *modelled* competitor, not against ProseMirror changing its real behaviour — the same class of blind spot that let PR #243 ship. The mitigation is one assertion on the **mechanism** rather than the outcome: after the click, ProseMirror's own selection must resolve inside the anchor target. That invariant is independent of the timing simulation and is false for anything that scrolls behind PM's back.
- **This tier is a fast signal, not a merge gate.** `infra/terraform/envs/shared/main.tf` does not set `required_status_checks`, so the module default `[]` applies and **no** check currently gates merge. This job is advisory exactly like the manual pass it replaces — the improvement is that it runs automatically and leaves a record, not that it blocks anything. Making checks required is a separate operator decision about merge gating.
- **Trade-offs**: a Playwright browser install in the `unit` workflow (~30s, no caching wired yet); a generated `index.generated.html` in the working tree (gitignored); and a harness that hand-copies the `/edit` route's pane geometry (53px topbar, 320px panel), which can drift from the route silently — a pointer comment in `apps/view/app/routes/$slug_.edit.tsx` names the harness so the two are edited together.
- **Neutral**: `tests/browser/**` is not covered by `pnpm typecheck`, identical to the pre-existing situation for `tests/e2e/**`. Worth closing for both at once, not for one of them here.

## More information

- `docs/adr/0046-adapter-sql-test-tier.md` — the precedent: a testing-taxonomy decision is repo-wide, so it is a standalone ADR rather than a bullet inside a feature ADR.
- `docs/adr/0062-editing-model-report-html-schema.md` — Amendment 3, Decision 7: the behaviour this tier first guards, and the record of what is and is not established about the ProseMirror mechanism.
- `docs/adr/0019` (in `docs/spec.html`) — infrastructure-first delivery; unchanged by this ADR.
- `.github/workflows/unit.yml` — the `browser` job.
- `tests/browser/playwright.config.ts`, `tests/browser/harness/build.mts` — the config and the harness.

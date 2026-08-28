# ADR-0085: Wire VIEW_ORIGIN on isolated previews so the cross-origin Save is testable

- **Status**: Accepted
- **Date**: 2026-08-28
- **Deciders**: agranado2k
- **Relates to**: ADR-0063 (in-viewer editing — the CORS posture this preserves, §"CORS posture (security-critical)" and §"Why no CSRF concern despite the relaxed CORS"; Phase 5-C recorded the retrimmed `editor-auth.feature` and the VIEW_ORIGIN-on-previews follow-up TODO this closes), ADR-0047 (per-PR preview isolation — the workflow amended here), ADR-0019 (infrastructure-first e2e — the tier the restored test lives in), ADR-0079 (the hermetic browser tier that still carries the toolbar's own behaviour). Closes issue #307.

## Context and problem statement

The unified editor's **Save** is a cross-origin browser fetch: view-origin page JS → app-origin `POST /api/v1/reports/{slug}/versions`, authorized by `Authorization: Bearer <editToken>` (ADR-0063 Phase 4). The app's CORS allow-list echoes the **exact** configured `VIEW_ORIGIN`, byte-for-byte, and **fails closed** when it is unset (ADR-0063 §CORS posture; `cors.server.ts` reads `defineEnv().VIEW_ORIGIN` per request, `packages/http/src/cors.ts` does the `!==` match).

Terraform wires `VIEW_ORIGIN` **prod-only** (`infra/terraform/envs/prod/main.tf`, `target = ["production"]`). On isolated previews it is unset, so the browser Save gets a CORS "Network error" — reproducibly. That is why the formatting epic's Save round-trip e2e (`tests/e2e/smoke/toolbar-formatting.feature`, ticket #297) was **deleted before #303 merged** (commit `48065b8`), and why `editor-auth.feature` verifies versions server-to-server and never clicks a browser Save. No e2e exercised the real cross-origin browser Save on preview — the one seam where the ADR-0063 CORS contract and the edit-token Bearer flow actually meet a browser.

## Decision drivers

- **Preserve the ADR-0063 CORS contract exactly.** Whatever previews do, the allow-list must stay a single exact origin, fail-closed — never `*`, never a reflected origin.
- **Robust for any branch name.** The preview pipeline runs on every PR; a fix that breaks on a long or unusual branch name is worse than the gap.
- **No product code change.** The app already reads `VIEW_ORIGIN` from env per request and the schema already treats it as optional; this is a deployment-wiring gap, not an app bug.
- **The test must be real.** The value is proving the cross-origin browser Save, not re-proving what the hermetic tier and the server-side pipeline tests already cover.

## Considered options

**A. Leave it — keep the Save round-trip prod-only.** The hermetic browser tier (ADR-0079) covers toolbar→document mutation, and the `save-edited-version.server` tests cover the pipeline. Rejected: the cross-origin browser fetch + CORS is exactly where an editor regression would hide (an origin typo, a preflight change, a header drift), and nothing observes it before production.

**B. Set `VIEW_ORIGIN` to the view's immutable per-deploy URL.** The literal reading of "thread the view URL into `VIEW_ORIGIN`". Rejected: it **cannot converge.** Each deploy gets a fresh immutable `.url`; the view is built pointing at the app's URL (`APP_ORIGIN`) and the app must be built with `VIEW_ORIGIN` = the view's URL. Setting `VIEW_ORIGIN` forces an app redeploy → new app URL → the view no longer points at it → redeploy the view → new view URL → `VIEW_ORIGIN` is stale — an infinite regress.

**C. Relax preview CORS to reflect/`*`.** Rejected outright: it contradicts ADR-0063 §CORS posture, the one contract this change exists to keep.

**D. Wire both sides to Vercel's STABLE git-branch aliases.** Every deployment carries a `<project>-git-<branch>-<team>.vercel.app` alias that survives redeploys. Point the view's `APP_ORIGIN` and the app's new `VIEW_ORIGIN` at each other's alias; the browser sits on the view alias, which the app's `VIEW_ORIGIN` names exactly. **Chosen.**

## Decision outcome

**Chosen: option D, wiring each side to the other's stable branch alias, entirely inside `.github/workflows/preview-isolation.yml`.**

The `redeploy` step now runs, per PR:

1. **(a)** redeploy the app, wait READY, read its stable alias from the deployment record (`.meta.branchAlias`);
2. **(b)** set the view project's `APP_ORIGIN` to the app *alias* (not the immutable URL — so it survives step e);
3. **(c)** redeploy the view, wait READY, read its stable alias;
4. **(d)** set the app project's `VIEW_ORIGIN` to the view alias;
5. **(e)** redeploy the app so it serves with `VIEW_ORIGIN` baked in. Its alias — already the view's `APP_ORIGIN` — now resolves to this deployment, so the pair is consistent: browser on the view alias → Save → app alias, whose `VIEW_ORIGIN` equals the view alias → CORS allows.

The job now emits the **stable aliases** as `app_url`/`view_url` (not immutable URLs), so the e2e's browser Origin equals the app's `VIEW_ORIGIN` byte-for-byte. The alias is read from the Vercel API, never hand-computed: Vercel truncates and hashes long branch names and the alias carries the team slug, none of which the workflow should try to reproduce. The branch-scoped `VIEW_ORIGIN` env is removed on PR close by the existing generic teardown (it deletes every `gitBranch`-scoped var), so no teardown change is needed.

**The CORS contract is unchanged.** Previews now name one exact origin — the paired view preview — echoed byte-for-byte, fail-closed for anything else; `Access-Control-Allow-Credentials` stays unset; the Bearer-token auth (not a cookie) is why relaxing CORS carries no CSRF exposure (ADR-0063 §"Why no CSRF concern"). Prod is untouched (Terraform still owns prod `VIEW_ORIGIN`).

The dropped e2e (`toolbar-formatting.feature` + `.steps.ts`) is **restored**, gated on `PLAYWRIGHT_VIEW_BASE_URL` / `E2E_SCAN_DRAIN_SECRET` exactly like `editor-auth`, and now drives the real browser Save.

### Consequences

- **Good**: the cross-origin browser Save — CORS, the preflight, the edit-token Bearer, reassembly, scan, and the served bytes — is proven end-to-end on every preview, closing ADR-0063's Phase 5-C TODO.
- **Bad / accepted**: a **third deploy per PR** (the second app redeploy). The app must build after `VIEW_ORIGIN` is set, and the view's origin is only known after the view deploys, so with API-read aliases three deploys is the minimum. This adds one app build (~a few minutes) to every PR's isolate job.
- **Recorded alternative (a 2-deploy variant)**: compute the view alias up front and set `VIEW_ORIGIN` before the app's first deploy, cross-checking the computed value against the API-returned alias and failing loud on mismatch. It trades the extra deploy for reproducing Vercel's alias slug/truncation + team-slug rules. Not taken now — robustness for any branch name is worth one deploy — but it is the obvious optimization if the added CI time bites.
- **Neutral**: `APP_ORIGIN` on the view moves from the immutable URL to the stable alias. This is strictly more correct (it already had to survive the view's own redeploy) and does not change what `editor-auth` observes.

### The test harness must not pollute the Save's preflight

Wiring `VIEW_ORIGIN` fixed the allow-list, but the restored e2e still failed —
for a second, unrelated reason worth recording. Playwright's global
`extraHTTPHeaders` inject Vercel's automation-bypass headers
(`x-vercel-protection-bypass`, `x-vercel-set-bypass-cookie`) on **every** request
to get through Deployment Protection. Those rode on the editor's real
cross-origin Save, whose preflight then advertised `x-vercel-set-bypass-cookie`
— which the app's CORS `Access-Control-Allow-Headers` (exactly
`Authorization, Content-Type`, ADR-0063) rejects, so the browser blocked the
Save before it left. Production never sends those headers.

Fix (test side, not product): the `chromium-auth` project (which runs the
`@browser` scenarios) drops the bypass headers, so the Save carries exactly what
prod sends. The app's strict CORS surface was **deliberately not widened** for an
infra header. This is safe because both preview projects have Deployment
Protection disabled, so navigation needs no bypass; the alternative that survives
protection being re-enabled is to deliver the bypass as a **cookie** (same-origin,
never sent on the `credentials: "omit"` cross-origin Save) rather than a header.

## More information

- Mechanism: `.github/workflows/preview-isolation.yml` (the `redeploy` step and the `isolate` job outputs). No app, package, or Terraform change.
- Test: `tests/e2e/smoke/toolbar-formatting.feature` + `.steps.ts` (ADR-0019 tier; skips locally, a skip fails in CI per `skip-guard.ts`).
- Contract preserved: ADR-0063 §"CORS posture (security-critical)" and §"Why no CSRF concern despite the relaxed CORS".

# E2E test fixtures

This suite runs against real infrastructure (ADR-019 — no mocks for external
services in e2e). Two Clerk identities are hand-provisioned on the **dev/staging**
Clerk instance (`pk_test`/`sk_test`, ADR-0048) so `@auth` scenarios can authenticate
as a real user with NO browser at all — `tests/e2e/support/clerk-session.ts` mints a
session token via the Clerk backend REST API, sent as a Bearer header on `request`
calls. This is the one accepted ADR-017 exception in this repo — a clicked fixture,
not code — so both identities are documented here for reconstructability (per
ADR-0068 §6).

`@browser` scenarios (below) authenticate the SAME primary identity, but in a real
Playwright browser — see "Authenticated-browser scenarios (`@browser`)".

## How the smoke runs in CI (trigger inversion, issue #149, amends ADR-0047)

`.github/workflows/e2e.yml` is a **reusable workflow** (`on: workflow_call`), not a
standalone trigger. `.github/workflows/preview-isolation.yml`'s `isolate` job calls
it, once, after it has:

1. Forked/reused the per-PR Neon branch and injected the branch-scoped env
   (`DATABASE_URL`, `R2_KEY_PREFIX`, `NEON_BRANCH`) on both Vercel projects.
2. Redeployed `arp-app-prod`, capturing the new deployment's `id`/`url` from the
   Vercel API response body (not just the HTTP status).
3. Polled `GET /v13/deployments/{id}` until Vercel's own `readyState` reaches
   `READY` (bounded ~5 minutes; fails loud on `ERROR`/`CANCELED`).

Only then does a `smoke` job invoke `e2e.yml` (`uses:
./.github/workflows/e2e.yml`) with `base_url` set to that exact, now-live
deployment URL and `head_sha` set to the PR's head commit. `secrets: inherit`
passes the caller's secrets through; repo `vars.*` resolve directly.

This replaces the old model, where `e2e.yml` listened for Vercel's
`deployment_status` event directly. That had two problems: (1)
`deployment_status` workflows only run from the **default branch**, so a CI
change to `e2e.yml` could never self-validate on its own PR — it shipped to
`main` unverified; (2) the app preview fires `deployment_status: success`
**twice** per commit (the initial push-triggered build, prod-DB fallback under
ADR-0047's soft-isolation window, and `preview-isolation.yml`'s force-redeploy),
indistinguishable from the event payload alone, so the smoke could race and run
against the pre-isolation (wrong-env) deployment.

With the inversion, there is exactly **one** e2e invocation per PR push, always
against a deployment `preview-isolation.yml` itself confirmed is isolated and
`READY`, running on the PR that made the change — including changes to the
workflow files themselves. Inside `e2e.yml`, the `/health` poll (`isolated`,
`checks.neon`) still runs, but now purely **defensively**: confirming the
caller's contract held and giving a cold/suspended Neon branch a bounded warm-up
grace window — not the primary mechanism for telling two racing deployments
apart, since there aren't two anymore.

## A skip in CI FAILS the job (`tests/e2e/support/skip-guard.ts`)

Silence is not success. This suite guards its most valuable scenarios behind
`test.skip(!process.env.X, …)`: `PLAYWRIGHT_VIEW_BASE_URL` for the cross-origin
owner-open hand-off, `E2E_SCAN_DRAIN_SECRET` for the scan drain that makes a
preview's upload servable at all. Those guards are **right locally** — a dev box
has no preview to follow to, and a suite that exploded there would simply get run
less. In CI they are the opposite: both variables are produced by
`preview-isolation.yml` and threaded through `e2e.yml`, so if either arrives
empty (a renamed job output, a `secrets:` block that stopped inheriting, a
dropped workflow input) the scenario skips, the job reports **green**, and
exactly the coverage that exists because two production incidents shipped through
that hop is gone with no signal at all.

So a custom reporter — registered in `playwright.config.ts`, active **only when
`CI` is set** — fails the run when:

- any collected test ends with outcome `skipped` and has not opted in; or
- the run collected **zero tests**. A `grep`/`grepInvert` combination wide
  enough to exclude the whole suite produces no skipped tests and a green run
  over no coverage, which the per-test rule cannot see.

**Opting a skip out.** Tag the scenario `@allow-skip` in its `.feature` (the tag
is in docs-conformance's `featureTags` vocabulary, so it is a reviewed decision,
not a stray string), or, for a plain `@playwright/test` spec with no Gherkin tags:

```ts
test.info().annotations.push({ type: "allow-skip", description: "why" });
```

**Nothing uses either today, and that is deliberate.** In particular
`clerk-auth.setup.ts` is *not* allowlisted: if the Clerk staging credentials ever
go missing in CI, that setup skips, `@auth`/`@browser` are grep-excluded, and the
run would otherwise be green over zero authenticated coverage. `e2e.yml` already
emits a `::warning::` for that case; the guard now makes it a failure. A scenario
that legitimately cannot run in CI is usually a scenario whose precondition
should be fixed instead.

## Assert the TERMINAL state (`tests/e2e/support/follow.ts`)

`editor-auth.feature` asserted the `303` off `/{slug}/edit?et=…` and stopped
there — through **two** production incidents (#188's re-nested `/edit` route and
the ADR-0080 owner lockout) that both happened on the request *after* it.

`followToTerminal(request, url, { headers })` walks a redirect chain to whatever
finally answers a non-redirect and returns `{ status, url, body, hops }`. It
carries cookies forward **across origins** (deliberately unscoped by domain: the
credential under test is the cross-origin `arp_edit` cookie), caps the hop count,
and throws with the whole chain on a loop rather than hanging.

Two rules go with it:

1. **Never assert only an intermediate hop.** Keep the intermediate assertion if
   it guards something specific — the `303` is the direct guard for #188 — and
   add a terminal one after it.
2. **Assert the body, not just the status.** A `200` alone proved insufficient
   this week: the public viewer, the unopenable-document page and the editor all
   answer with HTML, and only the editor carries `data-testid="unified-editor"`.

## Driving the scan drain on a preview (ADR-0045 / ADR-0080)

A report only becomes **servable** once its version scans `clean` (ADR-0037 §8).
In production a Cloudflare Cron Trigger Worker calls `POST /internal/scan-drain`
every ~minute; that Worker targets **prod only**, so on a PR preview *nothing*
promotes an upload past `scan_status: pending`. Any scenario that needs a
servable report therefore has to drive the drain itself.

That is why `editor-auth.feature` stopped at the `303` for so long: the request
after it — the one carrying the `arp_edit` cookie, and the one on which **both**
production incidents (#188's re-nested route, and the ADR-0080 owner lockout)
actually happened — can only ever redirect while the report is unservable.

**How the secret is wired.** Terraform provisions a `SCAN_DRAIN_SECRET` on the
Vercel `preview` target, but CI cannot know its value (it lives in the prod
Terraform state), and it cannot be passed between jobs either — the runner
redacts registered secrets out of job outputs, so a freshly generated masked
value arrives at the smoke job empty. So both jobs **derive the same value
independently**:

```
HMAC-SHA256( key = VERCEL_AUTOMATION_BYPASS_SECRET, msg = <this PR's head branch ref> )
```

- `preview-isolation.yml` computes it and upserts it as a **git-branch-scoped**
  Vercel env var on both projects, before the redeploy that makes it take
  effect. Branch-scoped, so it overrides the Terraform value for this PR's
  previews only and never touches production; teardown deletes it with every
  other branch-scoped var on PR close.
- `e2e.yml` computes the identical expression into `E2E_SCAN_DRAIN_SECRET`.

The two expressions must stay **byte-identical**. If they drift, the drain
answers `401` and the scenario fails loudly — the route is fail-closed (`503`
when unset, `401` on mismatch), so a broken wiring can never degrade into a
silent skip. **No new repo secret and no operator action are required.**

Absent the bypass secret (a plain local `pnpm e2e`), `E2E_SCAN_DRAIN_SECRET` is
unset and the drain-dependent steps skip cleanly, the same way
`PLAYWRIGHT_VIEW_BASE_URL` gates the cross-origin half.

## Fixture 1 — the primary test user

| | |
|---|---|
| Purpose | The `@auth @smoke` scenario (`tests/e2e/smoke/auth-upload.feature`) |
| Email | `E2E_TEST_USER_EMAIL` (a GitHub repo **variable**, not a secret — the address itself isn't sensitive) |
| Org (ADR-0068 §1) | Whatever its email domain resolves to. If it's a public-provider address (gmail.com, outlook.com, …), it lands in a `personal` org; otherwise it's the first (and likely only) member of that domain's `team` org. |
| Reconstruction | Sign up the address once on the dev Clerk instance (any method — email code, password, etc.) so it exists as a Clerk user. Set the GitHub Actions repo variable `E2E_TEST_USER_EMAIL` to that address. `E2E_CLERK_SECRET_KEY` (repo **secret**, `CLERK_SECRET_KEY_STAGING`) is already wired in `.github/workflows/e2e.yml`. |

## Fixture 2 — the second identity (ADR-0068 §6, team-org colleague)

| | |
|---|---|
| Purpose | Any scenario needing a SECOND real identity acting against the same report/org. `sharing-modes.feature` and `report-write-grants.feature` used to be listed here as the consumers; both were deleted on 2026-08-06 (their behaviour is covered by `resolve-access.test.ts`, `unlock-route.test.ts` and the write-grant use-case + contract suites). The live consumers are the run-scoped team fixtures below. |
| Email | `silver+clerk_test@agranado.com` — hardcoded as `SECOND_FIXTURE_EMAIL` in `tests/e2e/support/clerk-session.ts` (not a secret; a stable, documented fixture address, same rationale as fixture 1). |
| Why `+clerk_test`? | Clerk treats any address containing `+clerk_test` as **test mode**: it always verifies with the fixed code **`424242`**, no real inbox needed, no email actually sent. This only works on Clerk **test** instances (dev/staging here), never on `pk_live`. |
| Org (ADR-0068 §1) | Domain `agranado.com` is **not** on the public-provider list (`packages/domain/src/org-key.ts`), so this address resolves to a **`team`** org keyed by `agranado.com` — deliberately chosen so it exercises the team-org / multi-member paths, not another personal org. |
| Reconstruction | On the dev Clerk instance dashboard: create a user with email `silver+clerk_test@agranado.com` (any sign-up method; the `+clerk_test` suffix makes Clerk accept verification code `424242` for it). No further manual step is needed — the first authenticated request through the app JIT-provisions its `team` org (ADR-0068 §3); a second real user at `@agranado.com` (or the primary fixture, if its domain happens to also be `agranado.com`) would join the SAME org. |
| Minting a session for it | `mintSecondTestSession()` in `tests/e2e/support/clerk-session.ts` — needs only `E2E_CLERK_SECRET_KEY` (already wired for fixture 1; same dev instance). |

If this fixture is ever lost (Clerk instance reset, account deleted — cf. the
ADR-0049 instance-hygiene incident) — recreate it exactly as above and treat any
drift as a **fixture bug**, not a test bug (ADR-0068 §6's explicit call).

> **Slug-scheme note (superseded by ADR-0074):** the PR #158 domain-hash slug
> scheme is retired — team orgs are no longer looked up by slug at all. The
> join key is the app-owned `orgs.domain` DB index; the Clerk-side identity
> check is the `publicMetadata.domain` anchor (verified fail-closed), with a
> bounded anchor scan adopting any pre-index org. An old anchorless
> `agranado-com` org on the dev instance is simply never matched (the scan
> requires an exact anchor); the chain creates a fresh anchored org instead —
> no manual cleanup required, though deleting stale orgs keeps the dashboard
> tidy.

## Run-scoped team fixtures (ADR-0074, same-domain colleagues)

The `Two same-domain identities share one team org` scenario in
`tests/e2e/smoke/team-org-upload.feature` uses a PAIR of **run-scoped** identities —
`silver-<runId>+clerk_test@agranado.com` / `gold-<runId>+clerk_test@agranado.com`
(`runScopedTeamEmail` in `tests/e2e/support/clerk-session.ts`; `runId` fixed at worker
start) — proving both land in ONE org (the assertion the pre-ADR-0074 smoke
deliberately dodged).

| | |
|---|---|
| Why run-scoped (PR #222 round 3) | The per-PR Neon branch persists across pushes and forks from **prod** data — and a REUSED fixture can carry a poisoned mirror from an earlier run / older code (the original `silver` fixture is mirrored to its legacy hand-made "Ag47 Org" via historical ADR-0047 soft-isolation-window writes). ADR-0074's **sticky-after-mirror** policy then CORRECTLY honors that mirror forever, masking the canonical chain the scenario exists to prove. A user that didn't exist before this run cannot be mirrored anywhere, on any branch state. |
| Provisioning | **Programmatic, code-not-clicked**: `ensureTeamFixtureUser()` find-or-creates each Clerk user via the Backend API (`+clerk_test` test-mode addresses — no real inbox; the domain needn't receive mail). If the instance ever restricts Backend-API user creation, this scenario cannot run — fail-loud, no silent skip. |
| Decoy org (`arp-e2e-decoy-<localpart>`) | The dev instance runs `force_organization_selection: true` (same as prod), and Clerk gives a **zero-membership** user a `pending` session (task `choose-organization`) whose JWT carries `sts: "pending"` — @clerk/backend treats that as signed-out, so every request 401s (the PR #222 round-2 failure). In prod the ADR-0074 webhook pre-joins the user; e2e previews get no webhook, so the helper creates what the forced task itself would: an **anchorless decoy org** with the user as creator. Sessions then mint `active` — and since Clerk auto-activates the sole membership, the session actively CARRIES the decoy, faithfully reproducing the production duplicate-org shape: the app must ignore it (no `publicMetadata.domain`, so the anchor scan never adopts it) and land the user in the canonical domain org. |
| ADR-0078 tail (report sharing reaches a shared folder's contents) | The last six steps prove the reported bug and its repair against real infra. The first identity puts a PRIVATE report into the now-org-shared folder — and the move must NOT publish it (ADR-0078 §7: move is `canWrite`-gated, so auto-applying would let a write grantee publish what they cannot read). The third identity then CANNOT see it, which is the bug: a folder share confers visibility of the FOLDER only, and that assertion must keep passing forever — the repair is an EXPLICIT action, not a change to what a folder share means. `POST /folders/{id}/reports/sharing {sharing:"org_edit"}` then changes BOTH reports: the private one, and the already-`org_view` one, which ESCALATES because the candidate rule composes `reportSharingState(aclMode, hasOrgWrite)` and treats "composed state ≠ target" as a candidate. **A skip there is the pre-fix silent no-op, not the honest-partial contract** — the original assertion asserted exactly that skip and shipped the defect to `main` (PR #241 → #244). The honest-partial contract is instead covered by re-applying `org_edit` a second time: both reports then skip with `already shared with your org to view and edit`, the literal read from `ALREADY_AT` in the domain. Finally the third identity must LIST it, GET it (`sharing` reads back `org_edit` — computed server-side, never a value the test held), and PATCH-rename it — a rename goes through the `canWrite` seam, so a 200 there is the org-write leg working through the real HTTP door, not just in a unit test — while DELETE must still 403 (owner-only in every sharing state). |
| Assertion mechanics | Two-fold. (1) Clerk-side: after the second identity's first upload, the step asserts it holds a membership in the **anchored** `agranado.com` org (`findAnchoredOrgMembership` — BAPI read; absence fails loud, proving the canonical chain didn't join). (2) App-side: its session is **re-minted with that org active** (`POST /v1/sessions` `active_organization_id`, verified against the live BAPI — the v2 token's `o.id` claim reaches the app's `getAuth` as the session org, exactly like a browser session after the forced task's org selection), then a bare `GET /api/v1/reports` must list BOTH identities' uploads. A session *without* an active org can't be used for the read: the read path resolves an org-less session via the user's *oldest* membership — the unmirrored decoy. NOT `POST /settings/api-keys`: that dashboard action is cookie-session territory — a Bearer-token POST gets redirected to the sign-in HTML (the PR #222 round-2 failure). |
| Cleanup / accumulation | **Three layers, since issue #266** (the "noted follow-up" below stopped being optional when the leak took the pipeline down — see *Run-scoped identity hygiene*). (1) The prompt one: an `After({ tags: "@run-scoped" })` hook deletes both users (removing their canonical-org memberships — the shared anchored org's member count stays flat; the dev instance cap was raised 5 → 20 to match prod) and their decoy orgs after every attempt, pass or fail, now retrying 429/5xx. (2) The durable one: a Playwright **global teardown** deletes everything the run recorded in an on-disk ledger, including objects created by a provisioning call that threw before returning. (3) The self-healing one: an **age-gated sweep** at global setup *and* teardown. Cleanup failures still log loudly and never fail the scenario. |

## Run-scoped identity hygiene (issue #266)

**The incident.** Run-scoped identities leaked into the shared Clerk dev
instance until the anchored `agranado.com` team org (`org_3HK9gdegaQZ1qdkGPgN3RGOTWVO`)
hit its membership cap. The preview smoke — a merge-**required** check — began
failing `402 plan_limit_exceeded` while provisioning the third identity, then
the second, then would have reached the first. Retrying was the only mitigation
and it was running out.

**Why it leaked.** `firstFixture = await ensureTeamFixtureUser(…)` assigns only
on a clean return, and the cleanup hook can only delete what a step assigned.
But `ensureTeamFixtureUser` creates the Clerk user and *then* looks up
memberships and creates the decoy org — and those are exactly the calls a
saturated (402) or contended (429) instance fails. A throw there orphans a user
that no variable, no hook and no later run knows about. The loop is
self-reinforcing: the nearer the cap, the more provisioning throws, the faster
the cap fills. A cancelled or killed job leaked the same way, with no hook
running at all.

**The shape of the fix.**

| Piece | File |
|---|---|
| The pure identity contract — which addresses the suite mints, which are standing fixtures, the sweep predicate + age gate | `tests/e2e/support/clerk-fixture-identity.ts` (+ `.test.ts`) |
| The append-only ledger, written the instant each remote object exists | `tests/e2e/support/clerk-fixture-registry.ts` (+ `.test.ts`) |
| The Backend-API shell: paginated listing, tolerant + retrying deletes | `tests/e2e/support/clerk-fixture-sweep.ts`, `clerk-backend-api.ts` |
| Global setup (reset ledger + age-gated sweep) / teardown (purge ledger + sweep) | `tests/e2e/support/global-setup.ts`, `global-teardown.ts`, wired in `playwright.config.ts` |
| The operator's escalation lever | `.github/workflows/clerk-sweep.yml` |

**The pattern that decides what a sweep may touch** —
`^[a-z]{3,12}-[0-9a-z]{8,16}\+clerk_test@agranado\.com$`. It lives in
`RUN_SCOPED_EMAIL_PATTERN_SOURCE` and is repeated **byte-identically** in the
sweep workflow's `RUN_SCOPED_EMAIL_PATTERN` env var (bash + curl + jq cannot
import TypeScript). A unit test pins the literal, so changing one without the
other fails the build. The run-id length floor is what keeps a hyphenated human
address like `john-smith+clerk_test@agranado.com` out; the hand-provisioned
`silver+clerk_test@agranado.com` has no run id at all and additionally sits on
an exact-match never-sweep list, as does `E2E_TEST_USER_EMAIL`.

**The age gate.** The opportunistic sweeps only take identities older than
`SWEEP_MIN_AGE_HOURS` (24). Simultaneous PR runs share this instance — that
contention is the issue's second symptom — so an un-gated sweep would delete a
concurrent run's live fixtures mid-scenario. Only the manual workflow can sweep
with `older_than_hours: 0`.

**Running the sweep.** Actions → *Clerk dev-instance sweep* → Run workflow.
`dry_run` defaults to `true`: it prints the would-delete list and a count and
changes nothing. Re-run with `dry_run: false` to delete memberships + users.
`older_than_hours: 0` (the default) takes every run-scoped identity. Auth
failures fail the job loudly rather than reporting "0 matched".

**Contention.** The `smoke` job in `preview-isolation.yml` carries a shared
`concurrency: preview-smoke-shared` group (`cancel-in-progress: false`), so
parallel PRs queue against the one shared Clerk instance instead of colliding.
Only the smoke leg is grouped — `isolate` / `security-headers` / `teardown`
contend for nothing shared. Note GitHub keeps at most **one** pending run per
group, so a third simultaneous PR evicts the second's queued smoke; that's a
cancelled check needing a re-run, traded against a mid-suite 429.

## Authenticated-browser scenarios (`@browser`)

Every `@auth` scenario above is `request`-only — a session JWT sent as a Bearer
header, no browser involved. That can't exercise anything client-side (React
hydration, a mounted editor, computed styles inside a sandboxed iframe, …), which
is exactly the gap that let two prod incidents (#171 unstyled editor, #172
`ReferenceError: DOMParser is not defined` SSR 500 — both **behind auth**) sail
through CI untouched. `@browser` scenarios (e.g. `tests/e2e/smoke/editor-auth.feature`)
open a real Playwright `page` as a genuinely signed-in user instead.

**How the session is established** (`tests/e2e/support/clerk-auth.setup.ts`, a
Playwright **setup project** — a plain `@playwright/test` spec, not a BDD feature):

1. `clerkSetup({ publishableKey, secretKey })` (`@clerk/testing/playwright`) fetches
   a Clerk Testing Token from the Backend API — required so the FAPI requests
   `@clerk/clerk-js` makes from the browser bypass bot/captcha protection. Both
   keys are passed EXPLICITLY: `clerkSetup`'s own env fallbacks
   (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, …) don't match this
   repo's `E2E_`-prefixed convention.
2. `setupClerkTestingToken({ page })` registers a `context.route` interceptor that
   injects the testing token into FAPI requests — must run BEFORE `page.goto`,
   since that's what triggers `@clerk/clerk-js` to start calling FAPI.
3. `page.goto("/sign-in")` loads `@clerk/clerk-js` (root.tsx wires
   `PUBLIC_CLERK_PUBLISHABLE_KEY` into `ClerkApp` for every route).
4. `mintPrimarySignInTicket()` (`tests/e2e/support/clerk-session.ts`) mints a Clerk
   **sign-in ticket** (`POST /sign_in_tokens`, same `clerkFetch` primitive as
   `mintTestSessionFor`) for the primary fixture user.
5. `clerk.signIn({ page, signInParams: { strategy: "ticket", ticket } })` — the
   browser's OWN `Clerk.client.signIn.create` consumes the ticket client-side, so
   the resulting session (cookies, `window.Clerk.user`, …) is indistinguishable
   from an interactive sign-in.
6. `page.context().storageState({ path: "tests/e2e/.auth/primary.json" })`
   persists it — every `@browser` scenario reuses this ONE session rather than
   re-authenticating per test. The file is gitignored; never commit session state.

Deliberately NOT using `@clerk/testing`'s built-in `clerk.signIn({ page,
emailAddress })` convenience path: internally it reads `process.env.CLERK_SECRET_KEY`
directly (hardcoded name, not overridable in the call), which doesn't match
`E2E_CLERK_SECRET_KEY`. Minting the ticket ourselves keeps one env-var naming
scheme and needs no second secret.

**Wiring in `playwright.config.ts`:** three projects — `setup` (the spec above),
`chromium` (the existing unauthenticated/API-Bearer project — always excludes
`@browser`, since it has no storageState and can't run an authenticated scenario),
and `chromium-auth` (`dependencies: ["setup"]`, `storageState` applied, runs ONLY
`@browser`-tagged scenarios).

**Gate:** `@browser` needs everything `@auth` needs (`E2E_CLERK_SECRET_KEY` +
`E2E_TEST_USER_EMAIL`) **plus** `E2E_CLERK_PUBLISHABLE_KEY` — the ticket exchange
happens client-side, so `@clerk/clerk-js` needs the publishable key to initialize.
Missing any of the three grep-excludes `@browser` entirely (never runs
half-configured) — see the `grep`/`grepInvert` logic at the top of
`playwright.config.ts`.

## The 2026-08-06 corpus resolution — 33 files, 1 of which ran

`tests/e2e/features/` held **33** `.feature` files. Exactly **one**
(`folder-sharing.feature`) was opted into `playwright.config.ts`'s `features`
array, which is the only thing that makes a feature run. The other 32 were
step-less `@wip` skeletons. `docs-conformance` was green throughout, because it
validated a **bijection between the catalog and the directory** — a fact about
file names, which says nothing about execution.

**That is worse than an empty catalog.** A `.feature` file describing a
behaviour is precisely what stops the next person writing the test for it: the
coverage looks accounted for. So every one of the 32 was resolved with evidence,
and `status: "full"` now means one thing only — *this executes in CI*.

### Deleted (23) — the behaviour is genuinely verified elsewhere

The evidence for each is recorded as a tombstone in
`scripts/docs-conformance/config.mjs`, naming the tests that actually cover it.
Summarised by why:

| Deleted | Verified instead by |
| --- | --- |
| `upload-report-via-api` | the smoke `auth-upload.feature` — 201 + slug + canonical `view_url`, against real infrastructure |
| `view-report-while-scanning` | `view-report.test.ts`, `gate.server.test.ts` interstitial, `drain-scans.test.ts` — and the smoke `editor-auth` scenario drives the real `/internal/scan-drain` |
| `view-version-by-ordinal`, `view-published-report`, `report-flagged-unavailable`, `report-taken-down` | `view-report.test.ts` + `gate.server.test.ts` (451/410/404 precedence, `?v=N`, reason-opacity), `version-query.test.ts` |
| `sharing-modes`, `report-write-grants`, `cross-org-collaboration` | `resolve-access.test.ts` (every Examples row), `unlock-route.test.ts`, `grant-write`/`revoke-write`/`load-owned`/`get-acl` `.test.ts`, `write-grant-store.contract.ts` (two-runner) |
| `organize-reports-in-folders` | `move-report.test.ts`, `folder-repository.contract.ts`; the smoke `team-org-upload` creates a folder and moves a report for real |
| `idempotent-write-api` | `idempotent-write.test.ts` (all five scenarios), `idempotency-store.contract.ts`, `handle.server.test.ts` end-to-end through the seam |
| `problem-json-error-model`, `enforce-api-key-scopes`, `enforce-plan-limits` | `upload-response.test.ts` `CASES` (every error kind, each asserting the problem+json wire shape), `problem.test.ts`, `resolve-actor.server.test.ts` |
| `list-report-versions`, `comment-on-a-report` | `list-report-versions.test.ts`, `list-response.test.ts`; `reply-to-comment`/`list-comments`/`resolve-comment` `.test.ts`, `comment-repository.contract.ts` |
| `audit-log-every-action` | `audit-logger.contract.ts` (two-runner) + per-action rows in `set-acl`/`grant-write`/`move-report`; secret redaction in `create-api-key.test.ts` |
| `sign-up-and-switch-orgs` | `provision-identity.test.ts`, `report-repository.contract.ts` visibility; the smoke `team-org-upload` proves the one-org join on real infrastructure |
| `viewer-security-headers`, `viewer-origin-isolation`, `trusted-types-dashboard` | `view-headers.test.ts` / `app-headers.test.ts` / `cors.test.ts` — **plus** the deployed gate `view-headers.live.test.ts`, run by `security-headers.yml` against the real preview |
| `re-upload-keeps-url-stable` | `upload-report.test.ts` (`update_slug`, non-owner 403), `process-scan-result.test.ts`, `view-report.test.ts` |
| `upload-report-via-mcp` | `apps/mcp` `client.test.ts` + `tools.test.ts` — the tool is a thin wrapper over the same HTTP API |

### Wired (1)

`block-service-worker.feature` — the clearest hole in the corpus. Both
middlewares implement the ADR-0014 refusal correctly in four lines each, and
**nothing in the repo tested either of them**. It now runs on both origins,
asserting the middleware's own refusal body and `x-edge-marker` (never a bare
status — Deployment Protection also answers 4xx), plus a negative scenario so a
middleware that refused everything could not pass.

### Kept as declared coverage gaps (8)

Each is real, user-visible, and covered by **nothing** in any tier. They stay
`status: "wip"`, are not opted into the run, and each carries its note below.
Three of them (`upload-guardrails`, `reject-svg-upload`, `upload-report-via-web`)
were catalogued `"full"` before this pass, which was simply false.

| Use-case | What is missing, and why it cannot just be wired |
| --- | --- |
| `upload-guardrails` | **Not implemented.** `packages/adapters/src/bundle-processor.ts` is a single-document wrapper whose own header says the zip-extraction + MIME-sniff + caps processor "is a later slice". Zip-slip, decompression ratio, nested archives and all three hard caps (25 MiB / 20,000 entries / 250 MB inflated) have **zero** repo hits. Only the `PayloadTooLarge` → 413 wire mapping is tested. The most serious mismatch found: a security guardrail catalogued as fully covered with no enforcement behind it. |
| `reject-svg-upload` | **Not implemented**, same root cause. The only "coverage" is `upload-report.test.ts` passing a **stubbed** processor failure through the seam; nothing sniffs `image/svg+xml`. |
| `upload-report-via-web` | `apps/app/app/routes/upload.tsx` has **no test at all**, and no `*.test.ts` exists anywhere under `apps/app/app/routes/`. The `/upload` auth gate is smoke-covered (`dashboard-auth.feature`); choose-file → submit → see the view URL is not. Wiring it needs an authenticated browser form POST — feasible, but a distinct piece of work. Its scenario 3 is also **stale**: ADR-0075 made reports private by default, so the "anyone with the link" copy now describes the explicit `public` mode only. |
| `malware-scan-eicar` | **Not implemented.** The only scanner is `CleanStubScanner`, which always returns clean; `grep -r EICAR` finds nothing. The *pipeline* around it is covered (`process-scan-result.test.ts`), but nothing derives a bad verdict from content. |
| `submit-abuse-report` | **Not implemented.** The `abuse_reports` table exists (pinned structurally by `schema.test.ts`); there is no use case, port, route, or MCP tool, and `AbuseReported` is never emitted. |
| `enforce-rate-limits` | **Not implemented.** Both middlewares carry a literal `// TODO Phase 1: … rate limit via Upstash`. Only the `RateLimited` → 429 mapping is tested. |
| `detect-api-key-anomaly` | **Not implemented.** `grep -ri anomaly packages apps` returns nothing; `ApiKeyAnomalyDetected` exists only in the events registry. |
| `enforce-mfa` | **Not implemented.** Zero hits for `mfa` / `totp` / `multi-factor`. |

### Uncovered slices inside features that WERE deleted

Deleting a file whose narrative is 95% covered would bury the other 5%, so those
slices are recorded here instead:

- **`X-Robots-Tag: noindex`** is set by `apps/view/app/routes/$slug.tsx` and was
  asserted by three of the deleted feature files — and by **no test in the
  repo**. It is absent from the live header gate too. Cheapest real win on this
  list: one assertion in `packages/headers/src/view-headers.live.test.ts`.
- **CSP violation reporting.** `CspViolationReported` is a canonical event and
  `csp_reports` is a real table, but **there is no `/csp-report` route**. Only
  the `Report-To` header value is tested.
- **Denied-action auditing.** `uploadReport` returns `err(insufficientScope)`
  before reaching `deps.audit.record`, so a refused action leaves no audit row.
  No test, no implementation.
- **Route-level request validation.** Nothing under `apps/app/app/routes/` has a
  unit test, which is why the re-upload "content-only fields" 422 rule is
  unverified.
- **No real plan quota.** The production `PlanLimiter` is `AllowAllPlanLimiter`.
  The 402 mapping is well covered; the limit itself does not exist.
- **`UserCreated`** is in the events registry and is emitted nowhere.

### The mechanical guard that stops this recurring

`docs-conformance`'s **`feature-executes`** validator (with
`scripts/docs-conformance/test/feature-executes.test.mjs`) now requires, for
every catalogued use-case with `status: "full"`:

1. it is listed in `playwright.config.ts`'s `features` array;
2. a `<slug>.steps.ts` sits beside it;
3. it does not carry `@wip` (which `grepInvert` would silently exclude);

and the converse — a `"wip"` use-case must **not** be opted in, and a feature the
config runs must be catalogued. If the `features` array cannot be parsed at all,
that is a violation rather than a silent pass.

The authoritative "every step is defined" check is `pnpm e2e:gen` (`bddgen`
errors on an undefined step), run by `.github/workflows/unit.yml` on every PR.

## Historical note — the ADR-0068 blocker, now resolved

Fixture 2 makes it possible to mint a session for a second identity. It did
not, by itself, make `sharing-modes.feature` / `report-write-grants.feature`
executable: neither had step definitions, and `playwright.config.ts` only
collected `tests/e2e/smoke/**`. Both files were **deleted** in the 2026-08-06
pass above — their behaviour is covered by `resolve-access.test.ts`,
`unlock-route.test.ts`, the write-grant use-case tests and the two-runner
`write-grant-store.contract.ts`, and the org-write leg runs end-to-end against
real infrastructure in the smoke `team-org-upload.feature`.

## Product-feature scenarios that RUN (`tests/e2e/features/`)

`playwright.config.ts` opts features in **by name**, one at a time, rather than
by a directory glob — a glob over `tests/e2e/features/**` would fail at
collection, because playwright-bdd errors on a generated spec with undefined
steps and the remaining corpus is declared-gap skeletons. Listing a feature in
that array is the difference between coverage and decoration: an unlisted
`.feature` does not run, no matter how good it reads. That is now **enforced**,
not merely stated — see `feature-executes` above.

| Feature | Tags | Covers |
| --- | --- | --- |
| `block-service-worker.feature` (`block-service-worker.steps.ts`) | `@phase-1 @security @smoke` | ADR-0014 — the edge middleware refusing a `Service-Worker: script` fetch on **both** origins, asserted through the middleware's own refusal body and `x-edge-marker` rather than a bare status (Vercel Deployment Protection also answers 4xx on a preview, so a status-only check would pass on a deployment where the edge never ran). Plus the negative: an ordinary request is served, so a middleware that refused everything cannot pass. Deliberately an e2e and not a unit test — the middleware body is not the interesting part, the fact that the platform REACHES it is, and a mis-scoped `matcher` or an unbundled file is exactly what a direct call would miss. |
| `folder-sharing.feature` (`folder-sharing.steps.ts`) | `@phase-2 @smoke @auth` + `@run-scoped` | ADR-0076 §6 — the dashboard folder visibility + sharing UI. Two **run-scoped** identities at the same team domain (same fixture pattern as `team-org-upload.steps.ts`), driving the dashboard's OWN cookie-authenticated Remix action (a form POST to `/`) and asserting on the server-rendered sidebar markup: private-by-default on create; the Root renders no sharing kebab while a manageable folder on the same page does; the org toggle revealing a folder to a colleague; a colleague's menu refused with the server's own reason; the **nested-folder gap** (a parent going private leaves an already-org child visible) and the opt-in cascade closing it; share-by-email, the roster, the "Shared with 1" badge, and unshare. |

**A Bearer session DOES reach document routes.** The `@auth` table above notes that a
Bearer-token POST to `/settings/api-keys` "gets redirected to the sign-in HTML (the PR #222
round-2 failure)". That symptom was the **pending session**, not the door: a zero-membership
user's JWT carried `sts: "pending"`, which `@clerk/backend` treats as signed-out — so
`request.auth.userId` was null and root.tsx's gate redirected. The decoy-org fixture fixed that
by making sessions `active`. `rootAuthLoader` and `getAuth` call the SAME
`@clerk/remix` `authenticateRequest`, which authenticates a header token without a handshake, so
an active backend-minted session reaches the dashboard's loader and action exactly as it
reaches `/api/v1`. `folder-sharing.steps.ts` relies on that, and asserts `200` + the page's own
heading on the FIRST dashboard read so a regression here fails loudly and legibly instead of as
a puzzling missing-folder assertion.

Not covered by any e2e, and deliberately: **legacy-folder adoption**. A legacy
row is `owner_id IS NULL`, which only the pre-ADR-0076 backfill produces — there
is no supported way to mint one through the product — so the adoption warning
and the owner-or-legacy gate are pinned by unit tests on `folderManagement`
(`apps/app/app/server/folder-sharing.server.test.ts`) and by `load-owned.test.ts`
on the server rule that UI mirrors.

`tests/e2e/features/share-folders.feature` was **deleted** with that PR: it was a
step-less `@wip` skeleton whose own preamble pointed at the coverage that
actually runs, and its narrative is now carried by a feature that executes. The
2026-08-06 pass above applied the same reasoning to the other 32 files.

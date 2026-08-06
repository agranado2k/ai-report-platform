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
| Purpose | Any scenario needing a SECOND real identity acting against the same report/org — the `@phase-2 @wip` scenarios in `tests/e2e/features/sharing-modes.feature` (owner-only ACL read, org-mode unlock) and `tests/e2e/features/report-write-grants.feature` (the write-grant lifecycle) all need this and are blocked on more than just the fixture — see "Current status" below. |
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
| Cleanup / accumulation | An `After({ tags: "@run-scoped" })` hook best-effort deletes both users (removing their canonical-org memberships — the shared anchored org's member count stays flat; the dev instance cap was raised 5 → 20 to match prod) and their decoy orgs after every attempt, pass or fail. Cleanup failures log loudly but never fail the scenario; leaked users/orgs from crashed runs accumulate slowly on the (test-only) dev instance — a periodic sweep is a noted follow-up. |

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

## Current status — what's wired vs what's still blocked

Fixture 2 (this PR) makes it POSSIBLE to mint a session for a second identity. It
does **not**, by itself, make `sharing-modes.feature` / `report-write-grants.feature`
executable, because of a pre-existing gap that predates this PR:

- Neither feature file has ANY step definitions (unlike `tests/e2e/smoke/*.steps.ts`).
- `playwright.config.ts`'s `testDir` glob only includes `tests/e2e/smoke/**/*.feature`
  — the 29 product `.feature` files under `tests/e2e/features/` are not even
  collected by playwright-bdd yet (a long-standing TODO predating this PR — see
  the comment at the top of `playwright.config.ts` and `.github/workflows/e2e.yml`).

Authoring a full BDD step-definition layer for these two features (API client
helpers, two-session fixtures, org/ACL scenario wiring) is a distinct, sizeable
piece of work — comparable in scope to standing up the product-feature e2e layer
itself — and is out of scope for the ADR-0068 team-orgs PR. Both scenario files
stay `@wip` with this precise blocker noted inline; un-`@wip`-ing them, widening
`playwright.config.ts`'s `testDir`, and writing their step definitions is tracked
as separate follow-up work.

## Product-feature scenarios that RUN (`tests/e2e/features/`)

The "not even collected" statement above is no longer absolute. `playwright.
config.ts` now opts features in **by name**, one at a time, rather than by a
directory glob — a glob over `tests/e2e/features/**` would still fail at
collection, because playwright-bdd errors on a generated spec with undefined
steps and most of that corpus is still a step-less `@wip` skeleton. Listing a
feature in that array is therefore the difference between coverage and
decoration: an unlisted `.feature` does not run, no matter how good it reads.

| Feature | Tags | Covers |
| --- | --- | --- |
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
actually runs, and its narrative is now carried by a feature that executes.
